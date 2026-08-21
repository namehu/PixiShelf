import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AuditApplyInputEvidence,
  LocalDirectoryImportPayload,
  ScanAuditApplyPayload,
  ScanPayload,
  ScanV2Payload,
  WorkerCapability
} from '@pixishelf/job-contracts'
import { canonicalizeAuditApplyInputs } from '@pixishelf/job-contracts'
import { Prisma, PrismaClient } from '@pixishelf/db'
import {
  type FencedExecutionTransaction,
  JobExecutionFenceError,
  MutableQueueClock,
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type EnqueuedChildJob,
  type ExecutionContext,
  type ExecutionFence,
  type QueueDatabase,
  type QueueSqlExecutor
} from '@pixishelf/job-runtime'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { artistMappingInputDigest, localWorkInputDigest, metadataInputDigest } from '../digests.js'
import { hashStableFile, statStableFile } from '../content-reader.js'
import { executeConsistencyAudit } from '../consistency-audit-executor.js'
import { executeAuditApply } from '../audit-apply-executor.js'
import { hashScanRootIdentity } from '../inventory.js'
import {
  freezeIncrementalInventorySnapshot,
  recordExistingInventoryDecision,
  recordPublishedInventory
} from '../inventory-run.js'
import { executeLocalDirectoryImport } from '../local-executor.js'
import { resolveSafeScanRoot } from '../paths.js'
import { publishPixivArtwork } from '../pixiv-publisher.js'
import { executeScan } from '../scan-executor.js'
import {
  DEFAULT_SCAN_LIMITS,
  type ScanDatabase,
  type ScanExecutorDependencies,
  type ScanTransaction
} from '../types.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const concurrentPrisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
const testPrefix = `scan-executor-${randomUUID()}`
const clock = new MutableQueueClock(new Date('2026-08-14T18:00:00.000Z'))
const capabilities: WorkerCapability[] = [
  { jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1, 2, 3] },
  { jobType: 'LOCAL_DIRECTORY_IMPORT', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
]
const roots: string[] = []
let numericId = 8_000_000

describePostgres('scan executor PostgreSQL integration', () => {
  beforeEach(async () => cleanup())

  afterAll(async () => {
    await cleanup()
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
    await Promise.all([prisma?.$disconnect(), concurrentPrisma?.$disconnect()])
  })

  it('rolls back domain publication with its checkpoint, retries idempotently, and rejects a stale fence', async () => {
    const jobId = await seedJob('SCAN', { mode: 'INCREMENTAL' }, 1)
    const run = await client().scanRun.create({
      data: { systemJobId: jobId, type: 'PIXIV', mode: 'INCREMENTAL', status: 'RUNNING', startedAt: clock.now() }
    })
    const repository = queue()
    const claimed = await claim(repository, 'rollback')
    const externalId = nextNumericId()
    const publish = (transaction: ScanTransaction) =>
      publishPixivArtwork({
        transaction,
        runId: run.id,
        checkpointOrdinal: 0,
        checkpointKey: 'metadata:0:pg',
        metadataRelativePath: `pg/${externalId}-meta.json`,
        metadataContentHash: 'a'.repeat(64),
        metadata: metadata(externalId),
        media: [],
        existingPolicy: 'REFRESH',
        now: clock.now()
      })

    await expect(
      repository.withFencedMutationTransaction<ScanTransaction & QueueSqlExecutor>(
        fence(claimed),
        async (transaction) => {
          await publish(transaction)
          throw new Error('fault injection after checkpoint')
        }
      )
    ).rejects.toThrow('fault injection')
    expect(await client().artwork.count({ where: { externalId } })).toBe(0)
    expect(await client().scanRunItem.count({ where: { scanRunId: run.id } })).toBe(0)

    await repository.withFencedMutationTransaction<ScanTransaction & QueueSqlExecutor>(
      fence(claimed),
      async (transaction) => {
        await publish(transaction)
      }
    )
    await repository.withFencedMutationTransaction<ScanTransaction & QueueSqlExecutor>(
      fence(claimed),
      async (transaction) => {
        await publish(transaction)
      }
    )
    expect(await client().artwork.count({ where: { externalId } })).toBe(1)
    expect(await client().scanRunItem.count({ where: { scanRunId: run.id } })).toBe(1)
    const sourceRef = await client().artworkExternalRef.findUniqueOrThrow({
      where: { providerKey_externalId: { providerKey: 'pixiv', externalId } }
    })
    expect(sourceRef.metadataHash).toBe('a'.repeat(64))
    expect(await client().artworkSourceSnapshot.count({ where: { externalRefId: sourceRef.id } })).toBe(1)
    await repository.complete(fence(claimed))

    let callbackEntered = false
    await expect(
      repository.withFencedMutationTransaction(fence(claimed), async () => {
        callbackEntered = true
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(callbackEntered).toBe(false)
  })

  it('commits Pixiv publication and the processed inventory hash in the same fenced transaction', async () => {
    const jobId = await seedJob('SCAN', { mode: 'INCREMENTAL' }, 1)
    const externalId = nextNumericId()
    const relativePath = `atomic/${externalId}-meta.json`
    const contentHash = 'a'.repeat(64)
    const state = { sizeBytes: 10n, mtimeMs: 20n, ctimeMs: 30n, deviceId: 40n, inode: 50n }
    const run = await client().scanRun.create({
      data: {
        systemJobId: jobId,
        type: 'PIXIV',
        mode: 'INCREMENTAL',
        status: 'RUNNING',
        startedAt: clock.now(),
        parsedInputs: 0,
        publishedInputs: 0,
        publishDurationMs: 0
      }
    })
    const repository = queue()
    const claimed = await claim(repository, 'inventory-atomic')
    const publish = async (transaction: ScanTransaction) => {
      const result = await publishPixivArtwork({
        transaction,
        runId: run.id,
        checkpointOrdinal: 0,
        checkpointKey: 'metadata:0:inventory-atomic',
        metadataRelativePath: relativePath,
        metadataContentHash: 'a'.repeat(64),
        metadata: metadata(externalId),
        media: [],
        existingPolicy: 'REFRESH',
        now: clock.now()
      })
      await recordPublishedInventory({
        transaction,
        runId: run.id,
        checkpointOrdinal: 0,
        checkpointKey: 'metadata:0:inventory-atomic',
        relativePath,
        contentHash,
        state,
        externalId,
        publishStatus: result.status,
        publishDurationMs: 1,
        previousCheckpoint: null,
        now: clock.now()
      })
    }

    await expect(
      repository.withFencedMutationTransaction<ScanTransaction & QueueSqlExecutor>(
        fence(claimed),
        async (transaction) => {
          await publish(transaction)
          throw new Error('fault after inventory checkpoint')
        }
      )
    ).rejects.toThrow('fault after inventory checkpoint')
    expect(await client().artworkExternalRef.count({ where: { providerKey: 'pixiv', externalId } })).toBe(0)
    expect(await client().pixivMetadataInventory.count({ where: { relativePath } })).toBe(0)
    expect(await client().scanRunItem.count({ where: { scanRunId: run.id } })).toBe(0)

    await repository.withFencedMutationTransaction<ScanTransaction & QueueSqlExecutor>(fence(claimed), publish)
    expect(await client().artworkExternalRef.count({ where: { providerKey: 'pixiv', externalId } })).toBe(1)
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      observedContentHash: contentHash,
      processedContentHash: contentHash,
      lastAttemptedContentHash: contentHash
    })
  })

  it('builds a trusted baseline, skips stable content, and defers later source changes', async () => {
    const root = await fixtureRoot()
    const externalId = nextNumericId()
    const directory = path.join(root, 'pixiv')
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, `${externalId}-meta.json`), JSON.stringify(metadataDocument(externalId)))
    await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
    const artwork = await client().artwork.create({
      data: {
        title: `${testPrefix}-curated-title`,
        externalId: `${testPrefix}-legacy-${externalId}`,
        metaSource: relativePath,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN'
      }
    })
    const artworkBeforeBaseline = await client().artwork.findUniqueOrThrow({ where: { id: artwork.id } })
    await client().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'pixiv',
        externalId,
        canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
        locator: { artworkId: externalId }
      }
    })

    const baseline = await executeIncremental(root, 'inventory-baseline')
    expect(baseline).toMatchObject({
      status: 'COMPLETED',
      inputCount: 1,
      metadataCandidates: 1,
      contentHashed: 1,
      contentChanged: 1,
      parsedInputs: 1,
      publishedInputs: 0,
      failedInputs: 0,
      inventoryBaselineGeneration: 1
    })
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: baseline.id } })).toMatchObject({
      status: 'SKIPPED',
      action: 'SKIP_EXISTING',
      inventoryDecision: 'BASELINE_EXISTING'
    })
    const baselineInventory = await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })
    expect(baselineInventory.processedContentHash).toBe(baselineInventory.observedContentHash)
    expect((await client().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).title).toBe(
      `${testPrefix}-curated-title`
    )
    expect(await client().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).toEqual(artworkBeforeBaseline)

    const unchanged = await executeIncremental(root, 'inventory-unchanged')
    expect(unchanged).toMatchObject({
      status: 'COMPLETED',
      inputCount: 0,
      metadataCandidates: 1,
      inventoryUnchanged: 1,
      contentHashed: 0,
      parsedInputs: 0,
      publishedInputs: 0
    })
    expect(await client().scanRunItem.count({ where: { scanRunId: unchanged.id } })).toBe(0)

    await fs.writeFile(
      path.join(directory, `${externalId}-meta.json`),
      JSON.stringify({ ...metadataDocument(externalId), title: 'upstream changed title with a new length' })
    )
    const changed = await executeIncremental(root, 'inventory-changed')
    expect(changed).toMatchObject({
      status: 'COMPLETED',
      inputCount: 1,
      metadataCandidates: 1,
      contentHashed: 1,
      contentChanged: 1,
      parsedInputs: 1,
      publishedInputs: 0
    })
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: changed.id } })).toMatchObject({
      status: 'SKIPPED',
      action: 'SKIP_EXISTING',
      inventoryDecision: 'PENDING_SOURCE_REFRESH'
    })
    const changedInventory = await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })
    expect(changedInventory.observedContentHash).not.toBe(changedInventory.processedContentHash)
    expect((await client().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).title).toBe(
      `${testPrefix}-curated-title`
    )

    const pendingUnchanged = await executeIncremental(root, 'inventory-pending-unchanged')
    expect(pendingUnchanged).toMatchObject({
      status: 'COMPLETED',
      inputCount: 0,
      inventoryUnchanged: 1,
      contentHashed: 0,
      parsedInputs: 0
    })
    expect(await client().scanRunItem.count({ where: { scanRunId: pendingUnchanged.id } })).toBe(0)
  })

  it('replays a permanent failed checkpoint without parsing it or incrementing metrics again', async () => {
    const root = await fixtureRoot()
    const directory = path.join(root, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(root, relativePath), '{invalid json')
    const payload: ScanPayload = { mode: 'INCREMENTAL' }
    const jobId = await seedJob('SCAN', payload, 2)
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'permanent-replay-first')
    await executeScan(context(firstRepository, firstClaim, payload), dependencies(root))
    const run = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    const firstItem = await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: run.id } })
    expect(firstItem).toMatchObject({ status: 'FAILED', action: 'FAILED_PARSE', attempt: 1 })
    expect(run).toMatchObject({ status: 'FAILED', failedInputs: 1, parsedInputs: 0 })

    // If the permanent checkpoint were parsed again, the changed bytes would either import or
    // produce a second checkpoint attempt. Re-queueing the same job models lease recovery.
    await fs.writeFile(path.join(root, relativePath), JSON.stringify(metadataDocument(externalId)))
    await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
    await client().systemJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        availableAt: clock.now(),
        workerId: null,
        leaseToken: null,
        leaseExpiresAt: null,
        finishedAt: null,
        errorCode: null,
        error: null
      }
    })
    const replayRepository = queue()
    const replayClaim = await claim(replayRepository, 'permanent-replay-second')
    await executeScan(context(replayRepository, replayClaim, payload), dependencies(root))

    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: run.id } })).toMatchObject({
      status: 'FAILED',
      action: 'FAILED_PARSE',
      attempt: 1
    })
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'FAILED',
      failedInputs: 1,
      parsedInputs: 0,
      publishedInputs: 0
    })
    expect(await client().artworkExternalRef.count({ where: { providerKey: 'pixiv', externalId } })).toBe(0)
  })

  it('retries a retryable checkpoint in the same ScanRun without double-counting input metrics', async () => {
    const root = await fixtureRoot()
    await executeIncremental(root, 'retryable-empty-baseline')
    const directory = path.join(root, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(root, relativePath), JSON.stringify(metadataDocument(externalId)))
    const payload: ScanPayload = { mode: 'INCREMENTAL' }
    const jobId = await seedJob('SCAN', payload, 2)
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'retryable-replay-first')
    await executeScan(context(firstRepository, firstClaim, payload), dependencies(root))
    const run = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      lastErrorCode: 'MEDIA_NOT_FOUND',
      lastErrorRetryable: true
    })
    expect(run).toMatchObject({ status: 'RETRY_WAIT', failedInputs: 1, parsedInputs: 1, publishedInputs: 0 })

    await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
    clock.advance(60_001)
    const replayRepository = queue()
    const replayClaim = await claim(replayRepository, 'retryable-replay-second')
    await executeScan(context(replayRepository, replayClaim, payload), dependencies(root))

    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: run.id } })).toMatchObject({
      status: 'SUCCESS',
      action: 'CREATE',
      attempt: 2
    })
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'COMPLETED',
      failedInputs: 0,
      parsedInputs: 1,
      publishedInputs: 1
    })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      lastErrorCode: null,
      lastErrorRetryable: null
    })
  })

  it('reconciles a failed checkpoint when another run processes the same content before retry', async () => {
    const root = await fixtureRoot()
    await executeIncremental(root, 'interleaved-retry-empty-baseline')
    const directory = path.join(root, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(root, relativePath), JSON.stringify(metadataDocument(externalId)))
    const payload: ScanPayload = { mode: 'INCREMENTAL' }
    const jobId = await seedJob('SCAN', payload, 2)
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'interleaved-retry-first')
    await executeScan(context(firstRepository, firstClaim, payload), dependencies(root))
    const firstRun = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    expect(firstRun).toMatchObject({ status: 'RETRY_WAIT', failedInputs: 1 })

    await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
    const interveningRun = await executeIncremental(root, 'interleaved-retry-success')
    expect(interveningRun).toMatchObject({ status: 'COMPLETED', publishedInputs: 1 })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      lastSeenScanRunId: interveningRun.id,
      lastErrorCode: null,
      processedContentHash: expect.stringMatching(/^[a-f0-9]{64}$/)
    })

    clock.advance(60_001)
    const replayRepository = queue()
    const replayClaim = await claim(replayRepository, 'interleaved-retry-final')
    await executeScan(context(replayRepository, replayClaim, payload), dependencies(root))

    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: firstRun.id } })).toMatchObject({
      status: 'SKIPPED',
      action: 'SKIP_EXISTING'
    })
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: firstRun.id } })).toMatchObject({
      status: 'COMPLETED',
      failedInputs: 0,
      publishedInputs: 0
    })
    expect(await client().artworkExternalRef.count({ where: { providerKey: 'pixiv', externalId } })).toBe(1)
  })

  it('does not establish a trusted baseline when metaSource changes before the fenced CAS', async () => {
    const jobId = await seedJob('SCAN', { mode: 'INCREMENTAL' }, 1)
    const run = await client().scanRun.create({
      data: {
        systemJobId: jobId,
        type: 'PIXIV',
        mode: 'INCREMENTAL',
        status: 'RUNNING',
        startedAt: clock.now(),
        parsedInputs: 0,
        publishedInputs: 0,
        failedInputs: 0
      }
    })
    const repository = queue()
    const claimed = await claim(repository, 'baseline-cas')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    const artwork = await client().artwork.create({
      data: {
        title: `${testPrefix}-baseline-cas`,
        externalId: `${testPrefix}-baseline-cas-${externalId}`,
        metaSource: relativePath,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN'
      }
    })
    await client().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'pixiv',
        externalId,
        canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
        locator: { artworkId: externalId }
      }
    })

    await repository.withFencedMutationTransaction<ScanTransaction & QueueSqlExecutor>(
      fence(claimed),
      async (transaction) => {
        const coordinated = afterExternalRefLock(transaction, async () => {
          await concurrentClient().artwork.update({
            where: { id: artwork.id },
            data: { metaSource: `pixiv/${externalId}-moved-meta.json` }
          })
        })
        await recordExistingInventoryDecision({
          transaction: coordinated,
          runId: run.id,
          checkpointOrdinal: 0,
          checkpointKey: 'metadata:0:baseline-cas',
          relativePath,
          contentHash: 'a'.repeat(64),
          state: { sizeBytes: 10n, mtimeMs: 20n, ctimeMs: 30n, deviceId: 40n, inode: 50n },
          externalId,
          title: 'upstream',
          artistName: 'artist',
          inventoryBaselineGeneration: 1,
          inventoryRootPathHash: hashScanRootIdentity('/different-root'),
          now: clock.now()
        })
      }
    )

    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: run.id } })).toMatchObject({
      inventoryDecision: 'PENDING_SOURCE_REFRESH'
    })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      processedContentHash: null,
      observedContentHash: 'a'.repeat(64)
    })
  })

  it('converts an existing CLIENT_LIST skip into the trusted baseline and avoids false pending changes', async () => {
    const root = await fixtureRoot()
    const directory = path.join(root, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    const bytes = Buffer.from(JSON.stringify(metadataDocument(externalId)))
    await fs.writeFile(path.join(root, relativePath), bytes)
    await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
    const state = await statStableFile(path.join(await fs.realpath(root), relativePath))
    const row = {
      ordinal: 0,
      relativePath,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      ...state
    }
    const artwork = await client().artwork.create({
      data: {
        title: `${testPrefix}-client-before-baseline`,
        externalId: `${testPrefix}-client-before-baseline-${externalId}`,
        metaSource: relativePath,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN'
      }
    })
    await client().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'pixiv',
        externalId,
        canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
        locator: { artworkId: externalId }
      }
    })
    const executeClientSkip = async (suffix: string) => {
      const payload: ScanPayload = {
        mode: 'CLIENT_LIST',
        existingPolicy: 'SKIP',
        inputCount: 1,
        inputDigest: metadataInputDigest([row])
      }
      const jobId = await seedJob('SCAN', payload, 1)
      await client().scanRun.create({
        data: {
          systemJobId: jobId,
          type: 'PIXIV',
          mode: 'CLIENT_LIST',
          status: 'PENDING',
          inputFrozenAt: clock.now(),
          inputCount: 1,
          inputDigest: payload.inputDigest,
          metadataInputs: { create: row }
        }
      })
      const repository = queue()
      const claimed = await claim(repository, suffix)
      await executeScan(context(repository, claimed, payload), dependencies(root))
      return client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    }

    const beforeBaseline = await executeClientSkip('client-before-baseline')
    expect(beforeBaseline).toMatchObject({ contentHashed: null, contentChanged: null, hashDurationMs: null })
    expect(await client().pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: 'pixiv' } })).toMatchObject({
      status: 'INITIALIZING',
      rootPathHash: hashScanRootIdentity(await fs.realpath(root))
    })
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: beforeBaseline.id } })).toMatchObject({
      inventoryDecision: 'PENDING_SOURCE_REFRESH'
    })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      processedContentHash: null,
      observedContentHash: row.contentHash
    })

    const baseline = await executeIncremental(root, 'client-followed-by-baseline')
    expect(baseline).toMatchObject({ contentHashed: 0, contentChanged: 1, parsedInputs: 1 })
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: baseline.id } })).toMatchObject({
      inventoryDecision: 'BASELINE_EXISTING'
    })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      processedContentHash: row.contentHash,
      observedContentHash: row.contentHash
    })

    const afterBaseline = await executeClientSkip('client-after-baseline')
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: afterBaseline.id } })).toMatchObject({
      status: 'SKIPPED',
      action: 'SKIP_EXISTING',
      inventoryDecision: null
    })
  })

  it('does not let CLIENT_LIST consume baseline eligibility before the first traversal is complete', async () => {
    const root = await fixtureRoot()
    const directory = path.join(root, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    const bytes = Buffer.from(JSON.stringify(metadataDocument(externalId)))
    await fs.writeFile(path.join(root, relativePath), bytes)
    const fileState = await statStableFile(path.join(await fs.realpath(root), relativePath))
    const row = {
      ordinal: 0,
      relativePath,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      ...fileState
    }
    const artwork = await client().artwork.create({
      data: {
        title: `${testPrefix}-partial-baseline-${externalId}`,
        externalId: `${testPrefix}-partial-baseline-legacy-${externalId}`,
        metaSource: relativePath,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN'
      }
    })
    await client().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'pixiv',
        externalId,
        canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
        locator: { artworkId: externalId }
      }
    })

    const incrementalPayload: ScanPayload = { mode: 'INCREMENTAL' }
    const incrementalJobId = await seedJob('SCAN', incrementalPayload, 1)
    const interruptedRun = await client().scanRun.create({
      data: {
        systemJobId: incrementalJobId,
        type: 'PIXIV',
        mode: 'INCREMENTAL',
        status: 'RUNNING',
        startedAt: clock.now()
      }
    })
    const repository = queue()
    const claimed = await claim(repository, 'partial-baseline-discovery')
    const interruptedContext = context(repository, claimed, incrementalPayload)
    const originalMutate = interruptedContext.mutateInTransaction
    let mutations = 0
    interruptedContext.mutateInTransaction = (async (
      operation: (transaction: QueueSqlExecutor) => Promise<unknown>
    ) => {
      const result = await originalMutate(operation)
      mutations += 1
      if (mutations === 3) throw new Error('crash after partial baseline page')
      return result
    }) as typeof interruptedContext.mutateInTransaction

    await expect(
      freezeIncrementalInventorySnapshot({
        context: interruptedContext,
        database: dependencies(root).database,
        root: await resolveSafeScanRoot(root),
        run: interruptedRun,
        now: clock.now(),
        limits: { ...DEFAULT_SCAN_LIMITS, pageSize: 1 }
      })
    ).rejects.toThrow('crash after partial baseline page')
    expect(await client().pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: 'pixiv' } })).toMatchObject({
      status: 'INITIALIZING'
    })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      baselineEligible: true,
      processedContentHash: null
    })

    await repository.withFencedExecutionTransaction<ScanTransaction & QueueSqlExecutor>(
      fence(claimed),
      async (scope) => {
        await scope.transaction.scanRun.update({
          where: { id: interruptedRun.id },
          data: { status: 'CANCELLED', finishedAt: clock.now(), checkpointStage: 'CANCELLED' }
        })
        await scope.cancel('cancel interrupted baseline')
      }
    )

    const clientPayload: ScanPayload = {
      mode: 'CLIENT_LIST',
      existingPolicy: 'SKIP',
      inputCount: 1,
      inputDigest: metadataInputDigest([row])
    }
    const clientJobId = await seedJob('SCAN', clientPayload, 1)
    await client().scanRun.create({
      data: {
        systemJobId: clientJobId,
        type: 'PIXIV',
        mode: 'CLIENT_LIST',
        status: 'PENDING',
        inputFrozenAt: clock.now(),
        inputCount: 1,
        inputDigest: clientPayload.inputDigest,
        metadataInputs: { create: row }
      }
    })
    const clientRepository = queue()
    const clientClaim = await claim(clientRepository, 'client-during-partial-baseline')
    await executeScan(context(clientRepository, clientClaim, clientPayload), dependencies(root))
    const clientRun = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: clientJobId } })
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: clientRun.id } })).toMatchObject({
      inventoryDecision: 'PENDING_SOURCE_REFRESH'
    })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      processedContentHash: null,
      baselineEligible: false
    })

    const completedBaseline = await executeIncremental(root, 'complete-baseline-after-client')
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: completedBaseline.id } })).toMatchObject({
      inventoryDecision: 'BASELINE_EXISTING'
    })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      processedContentHash: row.contentHash,
      baselineEligible: false
    })
  })

  it('keeps baseline eligibility after cancellation between freeze and processing', async () => {
    const root = await fixtureRoot()
    const directory = path.join(root, 'pixiv')
    await fs.mkdir(directory, { recursive: true })
    const externalIds = [nextNumericId(), nextNumericId()]
    for (const externalId of externalIds) {
      const relativePath = `pixiv/${externalId}-meta.json`
      await fs.writeFile(path.join(root, relativePath), JSON.stringify(metadataDocument(externalId)))
      const artwork = await client().artwork.create({
        data: {
          title: `${testPrefix}-cancel-baseline-${externalId}`,
          externalId: `${testPrefix}-cancel-baseline-legacy-${externalId}`,
          metaSource: relativePath,
          source: 'PIXIV_IMPORTED',
          createdVia: 'PIXIV_SCAN'
        }
      })
      await client().artworkExternalRef.create({
        data: {
          artworkId: artwork.id,
          providerKey: 'pixiv',
          externalId,
          canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
          locator: { artworkId: externalId }
        }
      })
    }
    const payload: ScanPayload = { mode: 'INCREMENTAL' }
    const jobId = await seedJob('SCAN', payload, 1)
    const run = await client().scanRun.create({
      data: { systemJobId: jobId, type: 'PIXIV', mode: 'INCREMENTAL', status: 'RUNNING', startedAt: clock.now() }
    })
    const repository = queue()
    const claimed = await claim(repository, 'cancelled-baseline-freeze')
    const runDependencies = dependencies(root)
    await freezeIncrementalInventorySnapshot({
      context: context(repository, claimed, payload),
      database: runDependencies.database,
      root: await resolveSafeScanRoot(root),
      run,
      now: clock.now(),
      limits: { ...DEFAULT_SCAN_LIMITS, ...runDependencies.config.limits }
    })
    expect(await client().pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: 'pixiv' } })).toMatchObject({
      status: 'READY',
      baselineCompletedAt: clock.now()
    })
    await repository.withFencedExecutionTransaction<ScanTransaction & QueueSqlExecutor>(
      fence(claimed),
      async (scope) => {
        await scope.transaction.scanRun.update({
          where: { id: run.id },
          data: { status: 'CANCELLED', finishedAt: clock.now(), checkpointStage: 'CANCELLED' }
        })
        await scope.cancel('cancel after freeze')
      }
    )
    expect((await client().scanRun.findUniqueOrThrow({ where: { id: run.id } })).status).toBe('CANCELLED')

    const postCutoffId = nextNumericId()
    const postCutoffPath = `pixiv/${postCutoffId}-meta.json`
    await fs.writeFile(path.join(root, postCutoffPath), JSON.stringify(metadataDocument(postCutoffId)))
    const postCutoffArtwork = await client().artwork.create({
      data: {
        title: `${testPrefix}-post-cutoff-${postCutoffId}`,
        externalId: `${testPrefix}-post-cutoff-legacy-${postCutoffId}`,
        metaSource: postCutoffPath,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN'
      }
    })
    await client().artworkExternalRef.create({
      data: {
        artworkId: postCutoffArtwork.id,
        providerKey: 'pixiv',
        externalId: postCutoffId,
        canonicalUrl: `https://www.pixiv.net/artworks/${postCutoffId}`,
        locator: { artworkId: postCutoffId }
      }
    })

    const resumedBaseline = await executeIncremental(root, 'baseline-after-cancel')
    const decisions = await client().scanRunItem.findMany({
      where: { scanRunId: resumedBaseline.id },
      orderBy: { externalId: 'asc' },
      select: { externalId: true, inventoryDecision: true }
    })
    expect(decisions).toEqual(
      [
        ...externalIds.map((externalId) => ({ externalId, inventoryDecision: 'BASELINE_EXISTING' })),
        {
          externalId: postCutoffId,
          inventoryDecision: 'PENDING_SOURCE_REFRESH'
        }
      ].sort((left, right) => left.externalId.localeCompare(right.externalId))
    )
    expect(await client().pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: 'pixiv' } })).toMatchObject({
      status: 'READY',
      baselineCompletedAt: clock.now()
    })
  })

  it('recovers observed inputs after a crash between a discovery page commit and final freeze', async () => {
    const root = await fixtureRoot()
    const directory = path.join(root, 'pixiv')
    await fs.mkdir(directory, { recursive: true })
    const externalIds = [nextNumericId(), nextNumericId()]
    for (const externalId of externalIds) {
      await fs.writeFile(path.join(directory, `${externalId}-meta.json`), JSON.stringify(metadataDocument(externalId)))
      await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
    }
    const payload: ScanPayload = { mode: 'INCREMENTAL' }
    const jobId = await seedJob('SCAN', payload, 1)
    const run = await client().scanRun.create({
      data: { systemJobId: jobId, type: 'PIXIV', mode: 'INCREMENTAL', status: 'RUNNING', startedAt: clock.now() }
    })
    const repository = queue()
    const claimed = await claim(repository, 'inventory-discovery-crash')
    const executionContext = context(repository, claimed, payload)
    const originalMutate = executionContext.mutateInTransaction
    let mutations = 0
    executionContext.mutateInTransaction = (async (operation: (transaction: QueueSqlExecutor) => Promise<unknown>) => {
      const result = await originalMutate(operation)
      mutations += 1
      if (mutations === 3) throw new Error('crash after first discovery page')
      return result
    }) as typeof executionContext.mutateInTransaction
    const baseDependencies = dependencies(root)
    const oneItemPages = {
      ...baseDependencies,
      config: {
        ...baseDependencies.config,
        limits: { ...baseDependencies.config.limits!, pageSize: 1 }
      }
    }
    const safeRoot = await resolveSafeScanRoot(root)

    await expect(
      freezeIncrementalInventorySnapshot({
        context: executionContext,
        database: oneItemPages.database,
        root: safeRoot,
        run,
        now: clock.now(),
        limits: oneItemPages.config.limits as Required<typeof oneItemPages.config.limits>
      })
    ).rejects.toThrow('crash after first discovery page')
    expect(await client().pixivMetadataInventory.count()).toBe(1)
    expect(await client().scanRunMetadataInput.count({ where: { scanRunId: run.id } })).toBe(1)
    expect((await client().scanRun.findUniqueOrThrow({ where: { id: run.id } })).inputFrozenAt).toBeNull()

    executionContext.mutateInTransaction = originalMutate
    await expect(executeScan(executionContext, oneItemPages)).resolves.toEqual(
      TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    )
    expect(
      await client().artworkExternalRef.count({ where: { providerKey: 'pixiv', externalId: { in: externalIds } } })
    ).toBe(2)
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'COMPLETED',
      inputCount: 2,
      contentChanged: 2,
      publishedInputs: 2
    })
  })

  it('recovers changed content after a page crash without carrying forward the old permanent failure', async () => {
    const root = await fixtureRoot()
    const directory = path.join(root, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(root, relativePath), '{invalid json')
    const failedBaseline = await executeIncremental(root, 'changed-after-failure-baseline')
    expect(failedBaseline).toMatchObject({ status: 'FAILED', failedInputs: 1 })
    const oldAttemptedHash = (await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } }))
      .lastAttemptedContentHash

    await fs.writeFile(path.join(root, relativePath), JSON.stringify(metadataDocument(externalId)))
    await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
    const payload: ScanPayload = { mode: 'INCREMENTAL' }
    const jobId = await seedJob('SCAN', payload, 1)
    const run = await client().scanRun.create({
      data: { systemJobId: jobId, type: 'PIXIV', mode: 'INCREMENTAL', status: 'RUNNING', startedAt: clock.now() }
    })
    const repository = queue()
    const claimed = await claim(repository, 'changed-after-failure-crash')
    const executionContext = context(repository, claimed, payload)
    const originalMutate = executionContext.mutateInTransaction
    let mutations = 0
    executionContext.mutateInTransaction = (async (operation: (transaction: QueueSqlExecutor) => Promise<unknown>) => {
      const result = await originalMutate(operation)
      mutations += 1
      if (mutations === 3) throw new Error('crash after changed content observation')
      return result
    }) as typeof executionContext.mutateInTransaction
    const runDependencies = dependencies(root)

    await expect(
      freezeIncrementalInventorySnapshot({
        context: executionContext,
        database: runDependencies.database,
        root: await resolveSafeScanRoot(root),
        run,
        now: clock.now(),
        limits: { ...DEFAULT_SCAN_LIMITS, ...runDependencies.config.limits }
      })
    ).rejects.toThrow('crash after changed content observation')
    const observedAfterCrash = await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })
    expect(observedAfterCrash.observedContentHash).not.toBe(oldAttemptedHash)
    expect(observedAfterCrash.lastAttemptedContentHash).toBe(oldAttemptedHash)
    expect(observedAfterCrash.lastErrorRetryable).toBe(false)

    executionContext.mutateInTransaction = originalMutate
    await executeScan(executionContext, runDependencies)
    expect(await client().artworkExternalRef.count({ where: { providerKey: 'pixiv', externalId } })).toBe(1)
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      processedContentHash: observedAfterCrash.observedContentHash,
      lastErrorCode: null,
      lastErrorRetryable: null
    })
  })

  it('imports identities added after the baseline and advances processed content atomically', async () => {
    const root = await fixtureRoot()
    await executeIncremental(root, 'empty-baseline')
    const externalId = nextNumericId()
    const directory = path.join(root, 'pixiv')
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, `${externalId}-meta.json`), JSON.stringify(metadataDocument(externalId)))
    await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')

    const run = await executeIncremental(root, 'inventory-new')
    expect(run).toMatchObject({ status: 'COMPLETED', inputCount: 1, parsedInputs: 1, publishedInputs: 1 })
    const inventory = await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })
    expect(inventory.processedContentHash).toBe(inventory.observedContentHash)
    expect(inventory.externalRefId).not.toBeNull()
    const sourceRef = await client().artworkExternalRef.findUniqueOrThrow({
      where: { providerKey_externalId: { providerKey: 'pixiv', externalId } }
    })
    expect(sourceRef.metadataHash).toBe(inventory.processedContentHash)
    expect(await client().artworkSourceSnapshot.count({ where: { externalRefId: sourceRef.id } })).toBe(1)
  })

  it('continues valid inputs but keeps an unchanged permanent metadata failure visible without rehashing', async () => {
    const root = await fixtureRoot()
    await executeIncremental(root, 'failure-empty-baseline')
    const directory = path.join(root, 'pixiv')
    await fs.mkdir(directory, { recursive: true })
    const invalidId = nextNumericId()
    const validId = nextNumericId()
    const invalidPath = `pixiv/${invalidId}-meta.json`
    await fs.writeFile(path.join(directory, `${invalidId}-meta.json`), '{invalid json')
    await fs.writeFile(path.join(directory, `${validId}-meta.json`), JSON.stringify(metadataDocument(validId)))
    await fs.writeFile(path.join(directory, `${validId}_p0.jpg`), 'image')

    const failedRun = await executeIncremental(root, 'inventory-partial-failure')
    expect(failedRun).toMatchObject({
      status: 'FAILED',
      inputCount: 2,
      metadataCandidates: 2,
      contentHashed: 2,
      parsedInputs: 1,
      publishedInputs: 1,
      failedInputs: 1
    })
    expect(await client().artworkExternalRef.count({ where: { providerKey: 'pixiv', externalId: validId } })).toBe(1)
    expect(
      await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath: invalidPath } })
    ).toMatchObject({ lastErrorCode: 'METADATA_INVALID', lastErrorRetryable: false })

    const repeated = await executeIncremental(root, 'inventory-repeat-permanent')
    expect(repeated).toMatchObject({
      status: 'FAILED',
      inputCount: 0,
      metadataCandidates: 2,
      contentHashed: 0,
      parsedInputs: 0,
      publishedInputs: 0,
      failedInputs: 1,
      inventoryUnchanged: 1
    })
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: repeated.id } })).toMatchObject({
      metadataRelativePath: invalidPath,
      status: 'FAILED',
      action: 'FAILED_PARSE'
    })

    expect(await client().pixivMetadataInventoryState.findUniqueOrThrow({ where: { id: 'pixiv' } })).toMatchObject({
      status: 'READY',
      baselineCompletedAt: clock.now()
    })
    await fs.writeFile(
      path.join(directory, `${validId}-meta.json`),
      JSON.stringify({ ...metadataDocument(validId), title: 'changed after baseline with permanent sibling' })
    )
    const changedAfterFailedBaseline = await executeIncremental(root, 'changed-after-failed-baseline')
    expect(changedAfterFailedBaseline).toMatchObject({ status: 'FAILED', inputCount: 1, parsedInputs: 1 })
    expect(
      await client().scanRunItem.findFirstOrThrow({
        where: { scanRunId: changedAfterFailedBaseline.id, externalId: validId }
      })
    ).toMatchObject({ inventoryDecision: 'PENDING_SOURCE_REFRESH' })
  })

  it('rejects a frozen list from a different resolved root before it mutates inventory', async () => {
    const originalRoot = await fixtureRoot()
    const replacementRoot = await fixtureRoot()
    const directory = path.join(replacementRoot, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    const bytes = Buffer.from(JSON.stringify(metadataDocument(externalId)))
    await fs.writeFile(path.join(replacementRoot, relativePath), bytes)
    const state = await statStableFile(path.join(await fs.realpath(replacementRoot), relativePath))
    const row = {
      ordinal: 0,
      relativePath,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      ...state
    }
    await client().pixivMetadataInventoryState.create({
      data: {
        id: 'pixiv',
        status: 'READY',
        rootPathHash: hashScanRootIdentity(await fs.realpath(originalRoot)),
        baselineCompletedAt: clock.now()
      }
    })
    const payload: ScanPayload = {
      mode: 'CLIENT_LIST',
      existingPolicy: 'SKIP',
      inputCount: 1,
      inputDigest: metadataInputDigest([row])
    }
    const jobId = await seedJob('SCAN', payload, 1)
    const run = await client().scanRun.create({
      data: {
        systemJobId: jobId,
        type: 'PIXIV',
        mode: 'CLIENT_LIST',
        status: 'PENDING',
        inputFrozenAt: clock.now(),
        inputCount: 1,
        inputDigest: payload.inputDigest,
        metadataInputs: { create: row }
      }
    })
    const repository = queue()
    const claimed = await claim(repository, 'mismatched-inventory-root')

    await executeScan(context(repository, claimed, payload), dependencies(replacementRoot))

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'FAILED' })
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'FAILED' })
    expect(await client().pixivMetadataInventory.count()).toBe(0)
    expect(await client().scanRunItem.count({ where: { scanRunId: run.id } })).toBe(0)
  })

  it('classifies all audit differences without writing gallery domain tables', async () => {
    const root = await fixtureRoot()
    const canonicalRoot = await fs.realpath(root)
    await fs.mkdir(path.join(root, 'audit'), { recursive: true })
    const abortSignal = new AbortController().signal
    const writeMetadata = async (externalId: string, document: unknown = metadataDocument(externalId)) => {
      const relativePath = `audit/${externalId}-meta.json`
      await fs.writeFile(path.join(root, relativePath), JSON.stringify(document))
      return {
        externalId,
        relativePath,
        ...(await hashStableFile({
          absolutePath: path.join(canonicalRoot, relativePath),
          maxBytes: 32_000,
          signal: abortSignal
        }))
      }
    }

    const unchanged = await writeMetadata(nextNumericId())
    const changedId = nextNumericId()
    const changed = await writeMetadata(changedId, {
      ...metadataDocument(changedId),
      title: `${testPrefix}-changed-upstream`
    })
    await writeMetadata(nextNumericId())
    const inventoryOnly = await writeMetadata(nextNumericId())
    await writeMetadata(nextNumericId(), { invalid: true })
    const conflictExpectedId = nextNumericId()
    const conflictObservedId = nextNumericId()
    await writeMetadata(conflictExpectedId, metadataDocument(conflictObservedId))
    const drifted = await writeMetadata(nextNumericId())
    const duplicateRef = await writeMetadata(nextNumericId())
    const deletedRef = await writeMetadata(nextNumericId())
    const legacyConflict = await writeMetadata(nextNumericId())
    const missingExternalId = nextNumericId()
    const missingRelativePath = `missing/${missingExternalId}-meta.json`

    const createSource = async (externalId: string, relativePath: string) => {
      const artwork = await client().artwork.create({
        data: {
          title: `${testPrefix}-audit-source-${externalId}`,
          externalId: `${testPrefix}-legacy-${externalId}`,
          metaSource: relativePath,
          source: 'PIXIV_IMPORTED',
          createdVia: 'PIXIV_SCAN'
        }
      })
      return client().artworkExternalRef.create({
        data: {
          artworkId: artwork.id,
          providerKey: 'pixiv',
          externalId,
          canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
          locator: { artworkId: externalId }
        }
      })
    }
    const unchangedRef = await createSource(unchanged.externalId, unchanged.relativePath)
    const changedRef = await createSource(changed.externalId, changed.relativePath)
    const driftedRef = await createSource(drifted.externalId, drifted.relativePath)
    const duplicateRefSource = await createSource(duplicateRef.externalId, duplicateRef.relativePath)
    const deletedRefSource = await createSource(deletedRef.externalId, deletedRef.relativePath)
    await client().artwork.update({
      where: { id: driftedRef.artworkId },
      data: { metaSource: `drifted/${drifted.externalId}-meta.json` }
    })
    await client().artworkExternalRef.create({
      data: {
        artworkId: duplicateRefSource.artworkId,
        providerKey: 'pixiv',
        externalId: nextNumericId(),
        canonicalUrl: 'https://www.pixiv.net/artworks/duplicate',
        locator: { reason: 'duplicate-test-ref' }
      }
    })
    await client().artwork.create({
      data: {
        title: `${testPrefix}-legacy-conflict`,
        externalId: legacyConflict.externalId,
        source: 'PIXIV_IMPORTED',
        createdVia: 'UNKNOWN'
      }
    })
    const rootIdentity = await resolveSafeScanRoot(root)
    await client().pixivMetadataInventoryState.create({
      data: {
        id: 'pixiv',
        status: 'READY',
        rootPathHash: hashScanRootIdentity(canonicalRoot),
        rootDeviceId: rootIdentity.deviceId,
        rootInode: rootIdentity.inode,
        baselineCompletedAt: clock.now()
      }
    })
    await client().pixivMetadataInventory.create({
      data: {
        relativePath: unchanged.relativePath,
        externalId: unchanged.externalId,
        ...unchanged.state,
        observedContentHash: unchanged.sha256,
        processedContentHash: unchanged.sha256,
        lastAttemptedContentHash: unchanged.sha256,
        externalRefId: unchangedRef.id,
        createdAt: clock.now()
      }
    })
    for (const [candidate, externalRefId] of [
      [drifted, driftedRef.id],
      [duplicateRef, duplicateRefSource.id],
      [deletedRef, deletedRefSource.id]
    ] as const) {
      await client().pixivMetadataInventory.create({
        data: {
          relativePath: candidate.relativePath,
          externalId: candidate.externalId,
          ...candidate.state,
          observedContentHash: candidate.sha256,
          processedContentHash: candidate.sha256,
          lastAttemptedContentHash: candidate.sha256,
          externalRefId,
          createdAt: clock.now()
        }
      })
    }
    await client().artworkExternalRef.delete({ where: { id: deletedRefSource.id } })
    await client().pixivMetadataInventory.create({
      data: {
        relativePath: changed.relativePath,
        externalId: changed.externalId,
        sizeBytes: 1n,
        mtimeMs: 1n,
        observedContentHash: 'a'.repeat(64),
        processedContentHash: 'a'.repeat(64),
        lastAttemptedContentHash: 'a'.repeat(64),
        externalRefId: changedRef.id,
        createdAt: clock.now()
      }
    })
    await client().pixivMetadataInventory.create({
      data: {
        relativePath: inventoryOnly.relativePath,
        externalId: inventoryOnly.externalId,
        ...inventoryOnly.state,
        observedContentHash: null,
        processedContentHash: null,
        createdAt: clock.now()
      }
    })
    await client().pixivMetadataInventory.create({
      data: {
        relativePath: missingRelativePath,
        externalId: missingExternalId,
        sizeBytes: 1n,
        mtimeMs: 1n,
        observedContentHash: 'b'.repeat(64),
        processedContentHash: 'b'.repeat(64),
        lastAttemptedContentHash: 'b'.repeat(64),
        createdAt: clock.now()
      }
    })

    const domainBefore = await galleryDomainCounts()
    const payload = { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' } as const
    const jobId = await seedJob('SCAN', payload, 1, 2)
    const repository = queue()
    const claimed = await claim(repository, 'audit-five-kinds')
    const executionContext = context(repository, claimed, payload)
    let insertedAfterFreeze = false
    executionContext.progress = vi.fn(async () => {
      if (insertedAfterFreeze) return
      insertedAfterFreeze = true
      await client().pixivMetadataInventory.create({
        data: {
          relativePath: 'post-freeze/not-missing-meta.json',
          externalId: nextNumericId(),
          sizeBytes: 1n,
          mtimeMs: 1n,
          observedContentHash: 'c'.repeat(64),
          processedContentHash: 'c'.repeat(64),
          createdAt: new Date(clock.now().getTime() + 1)
        }
      })
    })
    await executeConsistencyAudit(executionContext, dependencies(root))

    const run = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    expect(run).toMatchObject({
      status: 'COMPLETED',
      operationKind: 'CONSISTENCY_AUDIT',
      inputCount: 10,
      inventoryUnchanged: 1,
      contentHashed: 6,
      contentChanged: 6,
      parsedInputs: 5,
      publishedInputs: 0,
      failedInputs: 6,
      missingInputs: 1,
      auditNewInputs: 2,
      auditChangedInputs: 1,
      auditInvalidInputs: 1,
      auditIdentityConflictInputs: 5
    })
    expect(
      await client().pixivSourceAuditItem.groupBy({
        by: ['differenceKind'],
        where: { scanRunId: run.id },
        _count: { _all: true },
        orderBy: { differenceKind: 'asc' }
      })
    ).toEqual([
      { differenceKind: 'CHANGED', _count: { _all: 1 } },
      { differenceKind: 'IDENTITY_CONFLICT', _count: { _all: 5 } },
      { differenceKind: 'INVALID', _count: { _all: 1 } },
      { differenceKind: 'MISSING', _count: { _all: 1 } },
      { differenceKind: 'NEW', _count: { _all: 2 } }
    ])
    expect(
      await client().pixivSourceAuditItem.findFirst({
        where: { scanRunId: run.id, relativePath: 'post-freeze/not-missing-meta.json' }
      })
    ).toBeNull()
    expect(await galleryDomainCounts()).toEqual(domainBefore)
    expect(
      await client().scanRunMetadataInput.count({
        where: { scanRunId: run.id, auditDifferenceKind: 'UNCHANGED', sourceAuditItemId: null }
      })
    ).toBe(1)
    expect(
      await client().pixivSourceAuditItem.findFirstOrThrow({
        where: { scanRunId: run.id, differenceKind: 'IDENTITY_CONFLICT' }
      })
    ).toMatchObject({ expectedExternalId: conflictExpectedId, observedExternalId: conflictObservedId })
    expect(
      await client().pixivSourceAuditItem.findFirstOrThrow({
        where: { scanRunId: run.id, relativePath: deletedRef.relativePath }
      })
    ).toMatchObject({ expectedExternalId: deletedRef.externalId, observedExternalId: deletedRef.externalId })
  })

  it('persists a large MISSING result set in bounded batches inside the final fenced transaction', async () => {
    const root = await fixtureRoot()
    const externalId = nextNumericId()
    const relativePath = `missing-batch/${externalId}-meta.json`
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true })
    await fs.writeFile(path.join(root, relativePath), JSON.stringify(metadataDocument(externalId)))
    await seedReadyAuditState(root)

    const missingCount = 1_201
    await client().pixivMetadataInventory.createMany({
      data: Array.from({ length: missingCount }, (_, index) => {
        const missingExternalId = String(30_000_000 + index)
        return {
          relativePath: `missing-batch/absent/${missingExternalId}-meta.json`,
          externalId: missingExternalId,
          sizeBytes: 1n,
          mtimeMs: 1n,
          observedContentHash: 'e'.repeat(64),
          processedContentHash: 'e'.repeat(64),
          lastAttemptedContentHash: 'e'.repeat(64),
          createdAt: clock.now()
        }
      })
    })

    const payload = { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' } as const
    const jobId = await seedJob('SCAN', payload, 1, 2)
    const repository = queue()
    const claimed = await claim(repository, 'audit-missing-batches')
    const executionContext = context(repository, claimed, payload)
    const originalFinalize = executionContext.finalizeInTransaction
    const batchSizes: number[] = []
    type AuditTransaction = ScanTransaction & QueueSqlExecutor
    type AuditScope = FencedExecutionTransaction<AuditTransaction>
    executionContext.finalizeInTransaction = ((operation: (scope: AuditScope) => Promise<void>) =>
      originalFinalize<AuditTransaction>((scope) =>
        operation({ ...scope, transaction: trackAuditItemBatches(scope.transaction, batchSizes) })
      )) as typeof executionContext.finalizeInTransaction

    await executeConsistencyAudit(executionContext, {
      ...dependencies(root),
      config: {
        ...dependencies(root).config,
        limits: { ...dependencies(root).config.limits!, maxEntries: 2_000, maxFullSweepReferences: 2_000 }
      }
    })

    expect(batchSizes).toEqual([500, 500, 201])
    expect(await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })).toMatchObject({
      status: 'COMPLETED',
      inputCount: 1,
      auditNewInputs: 1,
      missingInputs: missingCount
    })
    expect(
      await client().pixivSourceAuditItem.count({
        where: { scanRun: { systemJobId: jobId }, differenceKind: 'MISSING' }
      })
    ).toBe(missingCount)
  })

  it('rebuilds an empty audit snapshot when the paused job is resumed after files appear', async () => {
    const root = await fixtureRoot()
    await seedReadyAuditState(root)
    const payload = { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' } as const
    const jobId = await seedJob('SCAN', payload, 2, 2)
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'audit-empty-first')

    await executeConsistencyAudit(context(firstRepository, firstClaim, payload), dependencies(root))

    const pausedRun = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    expect(await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'PAUSED' })
    expect(pausedRun).toMatchObject({
      status: 'PAUSED',
      inputCount: 0,
      inputDigest: null,
      inputFrozenAt: null,
      inventoryBaselineGeneration: null,
      totalArtworks: 0,
      processedArtworks: 0,
      checkpointStage: 'PAUSED',
      checkpointOrdinal: 0,
      missingInputs: 0
    })
    expect(await client().scanRunMetadataInput.count({ where: { scanRunId: pausedRun.id } })).toBe(0)
    expect(await client().pixivSourceAuditItem.count({ where: { scanRunId: pausedRun.id } })).toBe(0)
    expect(await client().pixivMetadataInventory.count({ where: { lastSeenAuditRunId: pausedRun.id } })).toBe(0)

    const externalId = nextNumericId()
    const relativePath = `empty-resume/${externalId}-meta.json`
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true })
    await fs.writeFile(path.join(root, relativePath), JSON.stringify(metadataDocument(externalId)))
    await client().systemJob.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        availableAt: clock.now(),
        pauseRequestedAt: null,
        finishedAt: null,
        errorCode: null,
        error: null
      }
    })
    const resumedRepository = queue()
    const resumedClaim = await claim(resumedRepository, 'audit-empty-resumed')

    await executeConsistencyAudit(context(resumedRepository, resumedClaim, payload), dependencies(root))

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'COMPLETED' })
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: pausedRun.id } })).toMatchObject({
      status: 'COMPLETED',
      inputCount: 1,
      auditNewInputs: 1,
      missingInputs: 0
    })
    expect(await client().scanRunMetadataInput.count({ where: { scanRunId: pausedRun.id } })).toBe(1)
  })

  it('fails a missing-count safety overflow and requires a new audit after the limit changes', async () => {
    const root = await fixtureRoot()
    const presentExternalId = nextNumericId()
    const presentRelativePath = `missing-limit/${presentExternalId}-meta.json`
    await fs.mkdir(path.dirname(path.join(root, presentRelativePath)), { recursive: true })
    await fs.writeFile(path.join(root, presentRelativePath), JSON.stringify(metadataDocument(presentExternalId)))
    await seedReadyAuditState(root)
    await seedMissingAuditInventory(`missing-limit/absent/${nextNumericId()}-meta.json`)
    await seedMissingAuditInventory(`missing-limit/absent/${nextNumericId()}-meta.json`)
    const payload = { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' } as const
    const firstJobId = await seedJob('SCAN', payload, 1, 2)
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'audit-missing-limit-first')
    const baseDependencies = dependencies(root)

    await executeConsistencyAudit(context(firstRepository, firstClaim, payload), {
      ...baseDependencies,
      config: {
        ...baseDependencies.config,
        limits: { ...baseDependencies.config.limits!, maxFullSweepReferences: 1 }
      }
    })

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: firstJobId } })).toMatchObject({
      status: 'FAILED',
      errorCode: 'PRECONDITION_FAILED'
    })
    const failedRun = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: firstJobId } })
    expect(failedRun).toMatchObject({ status: 'FAILED', checkpointStage: 'FAILED', missingInputs: 0 })
    expect(
      await client().pixivSourceAuditItem.count({
        where: { scanRunId: failedRun.id, differenceKind: 'MISSING' }
      })
    ).toBe(0)

    const secondJobId = await seedJob('SCAN', payload, 1, 2)
    const secondRepository = queue()
    const secondClaim = await claim(secondRepository, 'audit-missing-limit-second')
    await executeConsistencyAudit(context(secondRepository, secondClaim, payload), {
      ...baseDependencies,
      config: {
        ...baseDependencies.config,
        limits: { ...baseDependencies.config.limits!, maxFullSweepReferences: 10 }
      }
    })

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: secondJobId } })).toMatchObject({
      status: 'COMPLETED'
    })
    expect(await client().scanRun.findUniqueOrThrow({ where: { systemJobId: secondJobId } })).toMatchObject({
      status: 'COMPLETED',
      missingInputs: 2
    })
  })

  it('reports a FAST identity conflict when inventory identity differs from the frozen filename without hashing', async () => {
    const root = await fixtureRoot()
    const expectedExternalId = nextNumericId()
    const inventoryExternalId = nextNumericId()
    const relativePath = `fast-identity/${expectedExternalId}-meta.json`
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true })
    const bytes = Buffer.from(JSON.stringify(metadataDocument(expectedExternalId)))
    await fs.writeFile(path.join(root, relativePath), bytes)
    const canonicalRoot = await fs.realpath(root)
    const state = await statStableFile(path.join(canonicalRoot, relativePath))
    const contentHash = createHash('sha256').update(bytes).digest('hex')
    const artwork = await client().artwork.create({
      data: {
        title: `${testPrefix}-fast-identity`,
        externalId: `${testPrefix}-fast-identity-legacy`,
        metaSource: relativePath,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN'
      }
    })
    const externalRef = await client().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'pixiv',
        externalId: inventoryExternalId,
        canonicalUrl: `https://www.pixiv.net/artworks/${inventoryExternalId}`,
        locator: { artworkId: inventoryExternalId }
      }
    })
    await seedReadyAuditState(root)
    await client().pixivMetadataInventory.create({
      data: {
        relativePath,
        externalId: inventoryExternalId,
        ...state,
        observedContentHash: contentHash,
        processedContentHash: contentHash,
        lastAttemptedContentHash: contentHash,
        externalRefId: externalRef.id,
        createdAt: clock.now()
      }
    })
    const domainBefore = await galleryDomainCounts()
    const payload = { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' } as const
    const jobId = await seedJob('SCAN', payload, 1, 2)
    const repository = queue()
    const claimed = await claim(repository, 'audit-fast-identity')

    await executeConsistencyAudit(context(repository, claimed, payload), dependencies(root))

    const run = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    expect(run).toMatchObject({
      status: 'COMPLETED',
      inputCount: 1,
      contentHashed: 0,
      parsedInputs: 0,
      auditIdentityConflictInputs: 1,
      inventoryUnchanged: 0
    })
    expect(await client().pixivSourceAuditItem.findFirstOrThrow({ where: { scanRunId: run.id } })).toMatchObject({
      differenceKind: 'IDENTITY_CONFLICT',
      expectedExternalId,
      observedExternalId: inventoryExternalId
    })
    expect(await galleryDomainCounts()).toEqual(domainBefore)
  })

  it('freezes every duplicate metadata path and reports both identities as conflicts without gallery writes', async () => {
    const root = await fixtureRoot()
    const canonicalRoot = await fs.realpath(root)
    const externalId = nextNumericId()
    const relativePaths = [
      `duplicate-identity/a/${externalId}-meta.json`,
      `duplicate-identity/b/${externalId}-meta.json`
    ]
    const frozen: Array<{ relativePath: string; state: Awaited<ReturnType<typeof statStableFile>>; hash: string }> = []
    for (const relativePath of relativePaths) {
      await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true })
      const bytes = Buffer.from(JSON.stringify(metadataDocument(externalId)))
      await fs.writeFile(path.join(root, relativePath), bytes)
      frozen.push({
        relativePath,
        state: await statStableFile(path.join(canonicalRoot, relativePath)),
        hash: createHash('sha256').update(bytes).digest('hex')
      })
    }
    await seedReadyAuditState(root)
    await client().pixivMetadataInventory.createMany({
      data: frozen.map((item) => ({
        relativePath: item.relativePath,
        externalId,
        ...item.state,
        observedContentHash: item.hash,
        processedContentHash: item.hash,
        lastAttemptedContentHash: item.hash,
        createdAt: clock.now()
      }))
    })
    const domainBefore = await galleryDomainCounts()
    const payload = { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' } as const
    const jobId = await seedJob('SCAN', payload, 1, 2)
    const repository = queue()
    const claimed = await claim(repository, 'audit-duplicate-identity')

    await executeConsistencyAudit(context(repository, claimed, payload), dependencies(root))

    const run = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    expect(run).toMatchObject({
      status: 'COMPLETED',
      inputCount: 2,
      contentHashed: 0,
      parsedInputs: 0,
      auditIdentityConflictInputs: 2,
      missingInputs: 0
    })
    expect(
      await client().scanRunMetadataInput.findMany({
        where: { scanRunId: run.id },
        select: { relativePath: true, auditDifferenceKind: true },
        orderBy: { relativePath: 'asc' }
      })
    ).toEqual(relativePaths.map((relativePath) => ({ relativePath, auditDifferenceKind: 'IDENTITY_CONFLICT' })))
    expect(
      await client().pixivSourceAuditItem.findMany({
        where: { scanRunId: run.id },
        select: { relativePath: true, differenceKind: true, issueCode: true },
        orderBy: { relativePath: 'asc' }
      })
    ).toEqual(
      relativePaths.map((relativePath) => ({
        relativePath,
        differenceKind: 'IDENTITY_CONFLICT',
        issueCode: 'DUPLICATE_METADATA_IDENTITY'
      }))
    )
    expect(await client().pixivSourceAuditItem.count({ where: { scanRunId: run.id, differenceKind: 'MISSING' } })).toBe(
      0
    )
    expect(await galleryDomainCounts()).toEqual(domainBefore)
  })

  it.each(['EMPTY', 'LIMIT', 'CANCEL', 'CHANGED_AFTER_FREEZE'] as const)(
    'never emits MISSING from an incomplete %s audit',
    async (scenario) => {
      const root = await fixtureRoot()
      const externalId = nextNumericId()
      const relativePath = `safety/${externalId}-meta.json`
      if (scenario !== 'EMPTY') {
        await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true })
        await fs.writeFile(path.join(root, relativePath), JSON.stringify(metadataDocument(externalId)))
      }
      await seedReadyAuditState(root)
      await seedMissingAuditInventory(`missing-${scenario.toLowerCase()}/${nextNumericId()}-meta.json`)
      const payload = { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' } as const
      const jobId = await seedJob('SCAN', payload, 1, 2)
      const repository = queue()
      const claimed = await claim(repository, `audit-safety-${scenario.toLowerCase()}`)
      const controller = new AbortController()
      const executionContext = context(repository, claimed, payload, controller.signal)
      if (scenario === 'CANCEL' || scenario === 'CHANGED_AFTER_FREEZE') {
        const originalMutate = executionContext.mutateInTransaction
        let injected = false
        executionContext.mutateInTransaction = (async (
          operation: (transaction: QueueSqlExecutor) => Promise<unknown>
        ) => {
          const result = await originalMutate(operation)
          if (
            !injected &&
            typeof result === 'object' &&
            result !== null &&
            'inputFrozenAt' in result &&
            (result as { inputFrozenAt: Date | null }).inputFrozenAt !== null
          ) {
            injected = true
            if (scenario === 'CANCEL') {
              await client().systemJob.update({
                where: { id: jobId },
                data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
              })
              controller.abort(new Error('cancel after freeze'))
            } else {
              await fs.writeFile(
                path.join(root, relativePath),
                JSON.stringify({ ...metadataDocument(externalId), title: 'changed after frozen audit snapshot' })
              )
            }
          }
          return result
        }) as typeof executionContext.mutateInTransaction
      }
      const baseDependencies = dependencies(root)
      await executeConsistencyAudit(executionContext, {
        ...baseDependencies,
        config: {
          ...baseDependencies.config,
          limits: {
            ...baseDependencies.config.limits!,
            ...(scenario === 'LIMIT' ? { maxEntries: 1 } : {})
          }
        }
      })
      const job = await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })
      expect(job.status).toBe(scenario === 'CANCEL' ? 'CANCELLED' : scenario === 'EMPTY' ? 'PAUSED' : 'FAILED')
      const run = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
      expect(run.status).toBe(job.status)
      expect(run.missingInputs).toBe(0)
      expect(
        await client().pixivSourceAuditItem.count({ where: { scanRunId: run.id, differenceKind: 'MISSING' } })
      ).toBe(0)
    }
  )

  it('replays a committed audit page and tolerates final ACK loss without duplicate items', async () => {
    const root = await fixtureRoot()
    const externalId = nextNumericId()
    const relativePath = `replay/${externalId}-meta.json`
    await fs.mkdir(path.dirname(path.join(root, relativePath)), { recursive: true })
    await fs.writeFile(path.join(root, relativePath), JSON.stringify(metadataDocument(externalId)))
    await seedReadyAuditState(root)
    const payload = { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' } as const
    const jobId = await seedJob('SCAN', payload, 2, 2)
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'audit-page-crash')
    const firstContext = context(firstRepository, firstClaim, payload)
    const originalMutate = firstContext.mutateInTransaction
    let crashed = false
    firstContext.mutateInTransaction = (async (operation: (transaction: QueueSqlExecutor) => Promise<unknown>) => {
      const result = await originalMutate(operation)
      if (!crashed && typeof result === 'string') {
        crashed = true
        throw new Error('crash after committed audit item')
      }
      return result
    }) as typeof firstContext.mutateInTransaction
    await executeConsistencyAudit(firstContext, dependencies(root))
    const run = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('RETRY_WAIT')
    expect(await client().pixivSourceAuditItem.count({ where: { scanRunId: run.id } })).toBe(1)

    clock.advance(60_001)
    const replayRepository = queue()
    const replayClaim = await claim(replayRepository, 'audit-ack-loss')
    const replayContext = context(replayRepository, replayClaim, payload)
    const originalFinalize = replayContext.finalizeInTransaction
    replayContext.finalizeInTransaction = (async (operation) => {
      const outcome = await originalFinalize(operation)
      throw new Error(`lost final ACK after ${outcome.kind}`)
    }) as typeof replayContext.finalizeInTransaction
    await expect(executeConsistencyAudit(replayContext, dependencies(root))).rejects.toBeInstanceOf(
      JobExecutionFenceError
    )
    expect(await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'COMPLETED' })
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      status: 'COMPLETED',
      auditNewInputs: 1
    })
    expect(await client().pixivSourceAuditItem.count({ where: { scanRunId: run.id } })).toBe(1)
  })

  it('applies frozen NEW evidence with metadata provenance and survives final ACK loss without duplicate writes', async () => {
    const fixture = await seedAuditApplyFixture({ includeMedia: true, maxAttempts: 2 })
    const repository = queue()
    const claimed = await claim(repository, 'audit-apply-ack-loss')
    const executionContext = context(repository, claimed, fixture.payload)
    const originalFinalize = executionContext.finalizeInTransaction
    executionContext.finalizeInTransaction = (async (operation) => {
      const outcome = await originalFinalize(operation)
      throw new Error(`lost apply ACK after ${outcome.kind}`)
    }) as typeof executionContext.finalizeInTransaction

    await expect(executeAuditApply(executionContext, dependencies(fixture.root))).rejects.toBeInstanceOf(
      JobExecutionFenceError
    )

    const item = await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: fixture.applyRunId } })
    expect(item).toMatchObject({ status: 'SUCCESS', applyOutcome: 'APPLIED', applyRetryable: false })
    const ref = await client().artworkExternalRef.findUniqueOrThrow({
      where: { providerKey_externalId: { providerKey: 'pixiv', externalId: fixture.externalId } }
    })
    expect(ref.metadataHash).toBe(fixture.contentHash)
    expect(await client().artworkSourceSnapshot.count({ where: { externalRefId: ref.id } })).toBe(1)
    expect(await client().artwork.count({ where: { id: item.resultArtworkId! } })).toBe(1)
    expect(
      await client().pixivMetadataInventory.findUniqueOrThrow({ where: { id: fixture.inventoryId } })
    ).toMatchObject({
      processedContentHash: fixture.contentHash,
      externalRefId: ref.id
    })
    expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'COMPLETED'
    })
  })

  it('marks changed source bytes STALE without gallery writes', async () => {
    const fixture = await seedAuditApplyFixture({ includeMedia: true })
    const domainBefore = await galleryDomainCounts()
    await fs.writeFile(
      path.join(fixture.root, fixture.relativePath),
      JSON.stringify({ ...metadataDocument(fixture.externalId), title: 'changed after audit' })
    )
    const repository = queue()
    const claimed = await claim(repository, 'audit-apply-stale')

    await executeAuditApply(context(repository, claimed, fixture.payload), dependencies(fixture.root))

    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: fixture.applyRunId } })).toMatchObject({
      status: 'SKIPPED',
      applyOutcome: 'SKIPPED',
      applyReasonCode: 'STALE_SOURCE_INPUT',
      applyRetryable: false
    })
    expect(await client().artwork.count({ where: { externalId: fixture.externalId } })).toBe(0)
    expect(await galleryDomainCounts()).toEqual(domainBefore)
  })

  it('applies CHANGED evidence to the exact locked source while preserving a curated title', async () => {
    const fixture = await seedAuditApplyFixture({ includeMedia: true, differenceKind: 'CHANGED' })
    const repository = queue()
    const claimed = await claim(repository, 'audit-apply-changed')

    await executeAuditApply(context(repository, claimed, fixture.payload), dependencies(fixture.root))

    const item = await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: fixture.applyRunId } })
    expect(item).toMatchObject({
      status: 'SUCCESS',
      applyOutcome: 'APPLIED',
      resultArtworkId: fixture.expectedArtworkId
    })
    expect(await client().artwork.findUniqueOrThrow({ where: { id: fixture.expectedArtworkId! } })).toMatchObject({
      title: `${testPrefix}-curated-${fixture.externalId}`,
      titleOverridden: true,
      metaSource: fixture.relativePath
    })
    const ref = await client().artworkExternalRef.findUniqueOrThrow({ where: { id: fixture.expectedExternalRefId! } })
    expect(ref.metadataHash).toBe(fixture.contentHash)
    expect(await client().artworkSourceSnapshot.count({ where: { externalRefId: ref.id } })).toBe(1)
  })

  it('recognizes content applied by another operation without duplicating domain writes', async () => {
    const first = await seedAuditApplyFixture({ includeMedia: true })
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'audit-apply-first-writer')
    await executeAuditApply(context(firstRepository, firstClaim, first.payload), dependencies(first.root))

    const second = await seedApplyOperationFromAudit(first)
    const secondRepository = queue()
    const secondClaim = await claim(secondRepository, 'audit-apply-already-applied')
    await executeAuditApply(context(secondRepository, secondClaim, second.payload), dependencies(first.root))

    const item = await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: second.applyRunId } })
    expect(item).toMatchObject({
      status: 'SKIPPED',
      applyOutcome: 'SKIPPED',
      applyReasonCode: 'ALREADY_APPLIED',
      applyRetryable: false
    })
    const ref = await client().artworkExternalRef.findUniqueOrThrow({
      where: { providerKey_externalId: { providerKey: 'pixiv', externalId: first.externalId } }
    })
    expect(item.resultArtworkId).toBe(ref.artworkId)
    expect(await client().artwork.count({ where: { externalId: first.externalId } })).toBe(1)
    expect(await client().artworkSourceSnapshot.count({ where: { externalRefId: ref.id } })).toBe(1)
  })

  it('allows a retryable missing-media result to be resubmitted from the same audit after repair', async () => {
    const first = await seedAuditApplyFixture({ includeMedia: false })
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'audit-apply-no-media')
    await executeAuditApply(context(firstRepository, firstClaim, first.payload), dependencies(first.root))

    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: first.applyRunId } })).toMatchObject({
      status: 'FAILED',
      applyOutcome: 'FAILED',
      applyReasonCode: 'MEDIA_NOT_FOUND',
      applyRetryable: true
    })

    await fs.writeFile(
      path.join(path.dirname(path.join(first.root, first.relativePath)), `${first.externalId}_p0.jpg`),
      'media'
    )
    const second = await seedApplyOperationFromAudit(first)
    const secondRepository = queue()
    const secondClaim = await claim(secondRepository, 'audit-apply-media-repaired')
    await executeAuditApply(context(secondRepository, secondClaim, second.payload), dependencies(first.root))

    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: second.applyRunId } })).toMatchObject({
      status: 'SUCCESS',
      applyOutcome: 'APPLIED',
      applyRetryable: false
    })
    expect(await client().artwork.count({ where: { externalId: first.externalId } })).toBe(1)
  })

  it('records identity drift as a conflict and never publishes domain changes', async () => {
    const fixture = await seedAuditApplyFixture({ includeMedia: true })
    const domainBefore = await galleryDomainCounts()
    await client().pixivMetadataInventory.update({
      where: { id: fixture.inventoryId },
      data: { externalId: nextNumericId() }
    })
    const repository = queue()
    const claimed = await claim(repository, 'audit-apply-conflict')

    await executeAuditApply(context(repository, claimed, fixture.payload), dependencies(fixture.root))

    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: fixture.applyRunId } })).toMatchObject({
      status: 'FAILED',
      applyOutcome: 'CONFLICT',
      applyReasonCode: 'SOURCE_IDENTITY_CHANGED',
      applyRetryable: false
    })
    expect(await client().artwork.count({ where: { externalId: fixture.externalId } })).toBe(0)
    expect(await galleryDomainCounts()).toEqual(domainBefore)
  })

  it('terminalizes every unfinished item when an audit apply is cancelled', async () => {
    const fixture = await seedAuditApplyFixture({ includeMedia: true })
    const repository = queue()
    const claimed = await claim(repository, 'audit-apply-cancel')
    const controller = new AbortController()
    const executionContext = context(repository, claimed, fixture.payload, controller.signal)
    const originalMutate = executionContext.mutateInTransaction
    let cancellationRequested = false
    executionContext.mutateInTransaction = (async (operation: (transaction: QueueSqlExecutor) => Promise<unknown>) => {
      const result = await originalMutate(operation)
      if (!cancellationRequested) {
        cancellationRequested = true
        await client().systemJob.update({
          where: { id: fixture.jobId },
          data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
        })
        controller.abort(new Error('cancel requested'))
      }
      return result
    }) as typeof executionContext.mutateInTransaction

    await executeAuditApply(executionContext, dependencies(fixture.root))

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'CANCELLED'
    })
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: fixture.applyRunId } })).toMatchObject({
      status: 'FAILED',
      applyOutcome: 'FAILED',
      applyReasonCode: 'OPERATION_CANCELLED',
      applyRetryable: true
    })

    const retry = await seedApplyOperationFromAudit(fixture)
    const retryRepository = queue()
    const retryClaim = await claim(retryRepository, 'audit-apply-after-cancel')
    await executeAuditApply(context(retryRepository, retryClaim, retry.payload), dependencies(fixture.root))
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: retry.applyRunId } })).toMatchObject({
      status: 'SUCCESS',
      applyOutcome: 'APPLIED'
    })
  })

  it('releases a worker shutdown during media collection without persisting a business failure', async () => {
    const fixture = await seedAuditApplyFixture({ includeMedia: true, maxAttempts: 2 })
    const repository = queue()
    const claimed = await claim(repository, 'audit-apply-media-shutdown')
    const interruption = new Error('worker shutdown during media collection')
    let abortChecks = 0
    const signal = {
      get aborted() {
        abortChecks += 1
        return abortChecks >= 4
      },
      get reason() {
        return interruption
      }
    } as AbortSignal

    await executeAuditApply(context(repository, claimed, fixture.payload, signal), dependencies(fixture.root))

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'PENDING'
    })
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: fixture.applyRunId } })).toMatchObject({
      status: 'PENDING',
      applyOutcome: null,
      applyReasonCode: null,
      applyRetryable: null
    })
    expect(await client().artwork.count({ where: { externalId: fixture.externalId } })).toBe(0)
  })

  it('retries when the source root is unavailable after claim and resumes the same operation after recovery', async () => {
    const fixture = await seedAuditApplyFixture({ includeMedia: true, maxAttempts: 2 })
    const unavailableRoot = `${fixture.root}-offline`
    await fs.rename(fixture.root, unavailableRoot)
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'audit-apply-root-offline')

    await executeAuditApply(context(firstRepository, firstClaim, fixture.payload), dependencies(fixture.root))

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'RETRY_WAIT'
    })
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: fixture.applyRunId } })).toMatchObject({
      status: 'RETRY_WAIT',
      checkpointStage: 'RETRY_WAIT'
    })
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: fixture.applyRunId } })).toMatchObject({
      status: 'PENDING',
      applyOutcome: null,
      applyRetryable: null
    })

    await fs.rename(unavailableRoot, fixture.root)
    clock.advance(60_001)
    const resumedRepository = queue()
    const resumedClaim = await claim(resumedRepository, 'audit-apply-root-restored')
    await executeAuditApply(context(resumedRepository, resumedClaim, fixture.payload), dependencies(fixture.root))
    expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'COMPLETED'
    })
  })

  it('terminalizes unfinished items as retryable when an infrastructure failure exhausts attempts', async () => {
    const fixture = await seedAuditApplyFixture({ includeMedia: true, maxAttempts: 1 })
    const unavailableRoot = `${fixture.root}-exhausted`
    await fs.rename(fixture.root, unavailableRoot)
    try {
      const repository = queue()
      const claimed = await claim(repository, 'audit-apply-root-exhausted')

      await executeAuditApply(context(repository, claimed, fixture.payload), dependencies(fixture.root))

      expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
        status: 'FAILED',
        errorCode: 'PRECONDITION_FAILED'
      })
      expect(await client().scanRun.findUniqueOrThrow({ where: { id: fixture.applyRunId } })).toMatchObject({
        status: 'FAILED',
        checkpointStage: 'FAILED'
      })
      expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: fixture.applyRunId } })).toMatchObject({
        status: 'FAILED',
        applyOutcome: 'FAILED',
        applyReasonCode: 'OPERATION_FAILED',
        applyRetryable: true
      })
      expect(await client().artwork.count({ where: { externalId: fixture.externalId } })).toBe(0)
    } finally {
      await fs.rename(unavailableRoot, fixture.root)
    }
  })

  it('resumes after a crash following the committed per-item transaction without republishing', async () => {
    const fixture = await seedAuditApplyFixture({ includeMedia: true, maxAttempts: 2 })
    const firstRepository = queue()
    const firstClaim = await claim(firstRepository, 'audit-apply-crash')
    const firstContext = context(firstRepository, firstClaim, fixture.payload)
    const originalMutate = firstContext.mutateInTransaction
    let injected = false
    firstContext.mutateInTransaction = (async (operation: (transaction: QueueSqlExecutor) => Promise<unknown>) => {
      const result = await originalMutate(operation)
      const completed = await client().scanRunItem.findFirst({
        where: { scanRunId: fixture.applyRunId, applyOutcome: 'APPLIED' }
      })
      if (!injected && completed) {
        injected = true
        throw new Error('crash after committed apply item')
      }
      return result
    }) as typeof firstContext.mutateInTransaction

    await executeAuditApply(firstContext, dependencies(fixture.root))
    expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'RETRY_WAIT'
    })
    clock.advance(60_001)
    const replayRepository = queue()
    const replayClaim = await claim(replayRepository, 'audit-apply-replay')
    await executeAuditApply(context(replayRepository, replayClaim, fixture.payload), dependencies(fixture.root))

    const ref = await client().artworkExternalRef.findUniqueOrThrow({
      where: { providerKey_externalId: { providerKey: 'pixiv', externalId: fixture.externalId } }
    })
    expect(await client().artwork.count({ where: { externalId: fixture.externalId } })).toBe(1)
    expect(await client().artworkSourceSnapshot.count({ where: { externalRefId: ref.id } })).toBe(1)
    expect(await client().scanRunItem.count({ where: { scanRunId: fixture.applyRunId } })).toBe(1)
    expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'COMPLETED'
    })
  })

  it('stats 10,000 stable metadata files without hashing, parsing, or publishing any input', async () => {
    const root = await fixtureRoot()
    const canonicalRoot = await fs.realpath(root)
    const directory = path.join(root, 'scale')
    await fs.mkdir(directory, { recursive: true })
    const rows: Array<{
      relativePath: string
      externalId: string
      sizeBytes: bigint
      mtimeMs: bigint
      ctimeMs: bigint | null
      deviceId: bigint | null
      inode: bigint | null
      observedContentHash: string
      processedContentHash: string
      lastAttemptedContentHash: string
      externalRefId: string
    }> = []
    for (let offset = 0; offset < 10_000; offset += 200) {
      const batch = Array.from({ length: Math.min(200, 10_000 - offset) }, (_, index) => offset + index + 1)
      await Promise.all(
        batch.map(async (value) => {
          const externalId = String(20_000_000 + value)
          const filename = `${externalId}-meta.json`
          const absolutePath = path.join(directory, filename)
          const content = JSON.stringify(metadataDocument(externalId))
          const contentHash = createHash('sha256').update(content).digest('hex')
          await fs.writeFile(absolutePath, content)
          const state = await statStableFile(path.join(canonicalRoot, 'scale', filename))
          rows.push({
            relativePath: `scale/${filename}`,
            externalId,
            ...state,
            observedContentHash: contentHash,
            processedContentHash: contentHash,
            lastAttemptedContentHash: contentHash,
            externalRefId: `${testPrefix}-scale-ref-${externalId}`
          })
        })
      )
    }
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500)
      await client().artwork.createMany({
        data: batch.map((row) => ({
          title: `${testPrefix}-scale-${row.externalId}`,
          externalId: `${testPrefix}-scale-legacy-${row.externalId}`,
          metaSource: row.relativePath,
          source: 'PIXIV_IMPORTED' as const,
          createdVia: 'PIXIV_SCAN' as const
        }))
      })
    }
    const scaleArtworks = await client().artwork.findMany({
      where: { title: { startsWith: `${testPrefix}-scale-` } },
      select: { id: true, metaSource: true }
    })
    const artworkByPath = new Map(scaleArtworks.map((artwork) => [artwork.metaSource, artwork.id]))
    for (let offset = 0; offset < rows.length; offset += 500) {
      const batch = rows.slice(offset, offset + 500)
      await client().artworkExternalRef.createMany({
        data: batch.map((row) => ({
          id: row.externalRefId,
          artworkId: artworkByPath.get(row.relativePath)!,
          providerKey: 'pixiv',
          externalId: row.externalId,
          canonicalUrl: `https://www.pixiv.net/artworks/${row.externalId}`,
          locator: { artworkId: row.externalId }
        }))
      })
    }
    await client().pixivMetadataInventoryState.create({
      data: {
        id: 'pixiv',
        status: 'READY',
        rootPathHash: hashScanRootIdentity(canonicalRoot),
        baselineCompletedAt: clock.now()
      }
    })
    for (let offset = 0; offset < rows.length; offset += 500) {
      await client().pixivMetadataInventory.createMany({ data: rows.slice(offset, offset + 500) })
    }

    const payload: ScanPayload = { mode: 'INCREMENTAL' }
    const jobId = await seedJob('SCAN', payload, 1)
    const repository = queue()
    const claimed = await claim(repository, 'inventory-scale')
    const baseDependencies = dependencies(root)
    await executeScan(context(repository, claimed, payload), {
      ...baseDependencies,
      config: {
        ...baseDependencies.config,
        limits: { ...baseDependencies.config.limits!, pageSize: 250, maxEntries: 20_000 }
      }
    })
    const run = await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
    expect(run).toMatchObject({
      status: 'COMPLETED',
      inputCount: 0,
      metadataCandidates: 10_000,
      inventoryUnchanged: 10_000,
      contentHashed: 0,
      contentChanged: 0,
      parsedInputs: 0,
      publishedInputs: 0,
      failedInputs: 0
    })

    const auditPayload = { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' } as const
    const auditJobId = await seedJob('SCAN', auditPayload, 1, 2)
    const auditRepository = queue()
    const auditClaim = await claim(auditRepository, 'audit-scale')
    await executeConsistencyAudit(context(auditRepository, auditClaim, auditPayload), {
      ...baseDependencies,
      config: {
        ...baseDependencies.config,
        limits: { ...baseDependencies.config.limits!, pageSize: 250, maxEntries: 20_000 }
      }
    })
    expect(await client().scanRun.findUniqueOrThrow({ where: { systemJobId: auditJobId } })).toMatchObject({
      status: 'COMPLETED',
      operationKind: 'CONSISTENCY_AUDIT',
      inputCount: 10_000,
      metadataCandidates: 10_000,
      inventoryUnchanged: 10_000,
      contentHashed: 0,
      contentChanged: 0,
      parsedInputs: 0,
      publishedInputs: 0,
      failedInputs: 0,
      missingInputs: 0
    })
    expect(await client().pixivSourceAuditItem.count({ where: { scanRun: { systemJobId: auditJobId } } })).toBe(0)
  }, 60_000)

  it('refreshes an existing Pixiv source without claiming curated tags or local artwork state', async () => {
    const jobId = await seedJob('SCAN', { mode: 'INCREMENTAL' }, 1)
    const run = await client().scanRun.create({
      data: { systemJobId: jobId, type: 'PIXIV', mode: 'INCREMENTAL', status: 'RUNNING', startedAt: clock.now() }
    })
    const repository = queue()
    const claimed = await claim(repository, 'refresh-ownership')
    const externalId = nextNumericId()
    const legacyExternalId = `${testPrefix}-local-${externalId}`
    const oldArtist = await client().artist.create({
      data: {
        name: `${testPrefix}-curated-artist`,
        username: `${testPrefix}-curated-artist`,
        userId: `curated-${externalId}`
      }
    })
    const artwork = await client().artwork.create({
      data: {
        title: `${testPrefix}-curated-title`,
        description: 'initial description',
        descriptionLength: 19,
        titleOverridden: false,
        descriptionOverridden: false,
        externalId: legacyExternalId,
        artistId: oldArtist.id,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN'
      }
    })
    const pixivRef = await client().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'pixiv',
        externalId,
        canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
        locator: { artworkId: externalId }
      }
    })
    const otherRef = await client().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'fixture-other',
        externalId,
        canonicalUrl: `https://fixture.invalid/${externalId}`,
        locator: { artworkId: externalId }
      }
    })
    const tagNames = [
      'stale-source',
      'legacy-overlap',
      'manual-overlap',
      'derived-overlap',
      'other-overlap',
      'new-source'
    ]
    const tags = await Promise.all(
      tagNames.map((name) =>
        client().tag.create({ data: { namespace: 'general', name: `${testPrefix}-${externalId}-${name}` } })
      )
    )
    await client().artworkTag.createMany({
      data: [
        { artworkId: artwork.id, tagId: tags[0]!.id, provenance: 'SOURCE', sourceRefId: pixivRef.id },
        { artworkId: artwork.id, tagId: tags[1]!.id, provenance: 'LEGACY' },
        { artworkId: artwork.id, tagId: tags[2]!.id, provenance: 'MANUAL' },
        { artworkId: artwork.id, tagId: tags[3]!.id, provenance: 'DERIVED' },
        { artworkId: artwork.id, tagId: tags[4]!.id, provenance: 'SOURCE', sourceRefId: otherRef.id }
      ]
    })
    await client().image.createMany({
      data: [
        { artworkId: artwork.id, path: `/pixiv/${externalId}_p0.jpg`, sortOrder: 10, size: 1n },
        { artworkId: artwork.id, path: `curated/${externalId}.jpg`, sortOrder: 3, size: 2n }
      ]
    })

    await repository.withFencedMutationTransaction<ScanTransaction & QueueSqlExecutor>(
      fence(claimed),
      async (transaction) => {
        const coordinatedTransaction = afterPixivSourceLookup(transaction, async () => {
          await concurrentClient().artwork.update({
            where: { id: artwork.id },
            data: { title: `${testPrefix}-concurrent-title`, titleOverridden: true }
          })
        })
        await publishPixivArtwork({
          transaction: coordinatedTransaction,
          runId: run.id,
          checkpointOrdinal: 0,
          checkpointKey: 'metadata:0:refresh-ownership',
          metadataRelativePath: `pixiv/${externalId}-meta.json`,
          metadataContentHash: 'a'.repeat(64),
          metadata: {
            ...metadata(externalId),
            title: 'upstream title',
            description: 'upstream description',
            tags: tags.slice(1).map((tag) => tag.name)
          },
          media: [media(`pixiv/${externalId}_p0.jpg`, 0), media(`pixiv/${externalId}_p1.jpg`, 1)],
          existingPolicy: 'REFRESH',
          now: clock.now()
        })
      }
    )

    const refreshed = await client().artwork.findUniqueOrThrow({ where: { id: artwork.id } })
    expect(refreshed).toMatchObject({
      title: `${testPrefix}-concurrent-title`,
      description: 'upstream description',
      descriptionLength: 20,
      externalId: legacyExternalId,
      artistId: oldArtist.id,
      titleOverridden: true,
      descriptionOverridden: false
    })
    const refreshedTags = await client().artworkTag.findMany({
      where: { artworkId: artwork.id },
      orderBy: { tagId: 'asc' },
      select: { tagId: true, provenance: true, sourceRefId: true }
    })
    expect(refreshedTags).toEqual(
      [
        { tagId: tags[1]!.id, provenance: 'LEGACY', sourceRefId: null },
        { tagId: tags[2]!.id, provenance: 'MANUAL', sourceRefId: null },
        { tagId: tags[3]!.id, provenance: 'DERIVED', sourceRefId: null },
        { tagId: tags[4]!.id, provenance: 'SOURCE', sourceRefId: otherRef.id },
        { tagId: tags[5]!.id, provenance: 'SOURCE', sourceRefId: pixivRef.id }
      ].sort((left, right) => left.tagId - right.tagId)
    )
    const refreshedImages = await client().image.findMany({
      where: { artworkId: artwork.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: { path: true, sortOrder: true }
    })
    expect(refreshedImages).toEqual([
      { path: `curated/${externalId}.jpg`, sortOrder: 3 },
      { path: `/pixiv/${externalId}_p0.jpg`, sortOrder: 10 },
      { path: `pixiv/${externalId}_p1.jpg`, sortOrder: 11 }
    ])
    expect(await client().artist.count({ where: { userId: externalId } })).toBe(0)
  })

  it('rejects an artwork rescan when its source changes after the snapshot is frozen', async () => {
    const root = await fixtureRoot()
    const directory = path.join(root, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    const bytes = Buffer.from(JSON.stringify(metadataDocument(externalId)))
    await fs.writeFile(path.join(root, relativePath), bytes)
    await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
    const state = await statStableFile(path.join(await fs.realpath(root), relativePath))
    const row = {
      ordinal: 0,
      relativePath,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      ...state
    }
    const artwork = await client().artwork.create({
      data: {
        title: `${testPrefix}-stale-rescan`,
        externalId: `${testPrefix}-stale-rescan-${externalId}`,
        source: 'PIXIV_IMPORTED',
        createdVia: 'PIXIV_SCAN',
        metaSource: relativePath
      }
    })
    await client().artworkExternalRef.create({
      data: {
        artworkId: artwork.id,
        providerKey: 'pixiv',
        externalId,
        canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
        locator: { artworkId: externalId }
      }
    })
    const payload: ScanPayload = { mode: 'ARTWORK_RESCAN', artworkId: artwork.id }
    const jobId = await seedJob('SCAN', payload, 1)
    const run = await client().scanRun.create({
      data: {
        systemJobId: jobId,
        type: 'PIXIV',
        mode: 'RESCAN',
        status: 'PENDING',
        inputFrozenAt: clock.now(),
        inputCount: 1,
        inputDigest: metadataInputDigest([row]),
        metadataInputs: { create: row }
      }
    })
    const replacementPath = `local-imports/${externalId}`
    await client().artwork.update({
      where: { id: artwork.id },
      data: { source: 'URL_ARCHIVE', metaSource: replacementPath }
    })
    const repository = queue()
    const claimed = await claim(repository, 'stale-artwork-rescan')

    await executeScan(context(repository, claimed, payload), dependencies(root))

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).toMatchObject({ status: 'FAILED' })
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: 'FAILED' })
    expect(await client().artwork.findUniqueOrThrow({ where: { id: artwork.id } })).toMatchObject({
      title: `${testPrefix}-stale-rescan`,
      source: 'URL_ARCHIVE',
      metaSource: replacementPath
    })
    expect(await client().image.count({ where: { artworkId: artwork.id } })).toBe(0)
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      processedContentHash: null,
      lastErrorCode: 'STATE_CONFLICT',
      lastErrorRetryable: null
    })

    await client().artwork.update({ where: { id: artwork.id }, data: { metaSource: relativePath } })
    const recovered = await executeIncremental(root, 'recover-stale-artwork-rescan')
    expect(await client().scanRunItem.findFirstOrThrow({ where: { scanRunId: recovered.id } })).toMatchObject({
      inventoryDecision: 'BASELINE_EXISTING'
    })
    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      processedContentHash: row.contentHash,
      lastErrorCode: null
    })
  })

  it('refreshes a URL archive artwork through its unambiguous Pixiv source reference', async () => {
    const root = await fixtureRoot()
    const fixture = await frozenArtworkRescanFixture(root, 'URL_ARCHIVE')
    const repository = queue()
    const claimed = await claim(repository, 'url-archive-pixiv-rescan')

    await executeScan(context(repository, claimed, fixture.payload), dependencies(root))

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'COMPLETED'
    })
    expect(await client().artwork.findUniqueOrThrow({ where: { id: fixture.artwork.id } })).toMatchObject({
      source: 'URL_ARCHIVE',
      metaSource: fixture.relativePath
    })
    expect(await client().image.count({ where: { artworkId: fixture.artwork.id } })).toBe(1)
    expect(
      await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath: fixture.relativePath } })
    ).toMatchObject({ processedContentHash: fixture.row.contentHash })
  })

  it('rejects an artwork rescan if a second Pixiv source appears after freeze', async () => {
    const root = await fixtureRoot()
    const fixture = await frozenArtworkRescanFixture(root, 'PIXIV_IMPORTED')
    const secondExternalId = nextNumericId()
    await client().artworkExternalRef.create({
      data: {
        artworkId: fixture.artwork.id,
        providerKey: 'pixiv',
        externalId: secondExternalId,
        canonicalUrl: `https://www.pixiv.net/artworks/${secondExternalId}`,
        locator: { artworkId: secondExternalId }
      }
    })
    const repository = queue()
    const claimed = await claim(repository, 'ambiguous-artwork-rescan')

    await executeScan(context(repository, claimed, fixture.payload), dependencies(root))

    expect(await client().systemJob.findUniqueOrThrow({ where: { id: fixture.jobId } })).toMatchObject({
      status: 'FAILED'
    })
    expect(await client().image.count({ where: { artworkId: fixture.artwork.id } })).toBe(0)
    expect(
      await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath: fixture.relativePath } })
    ).toMatchObject({ processedContentHash: null, lastErrorCode: 'STATE_CONFLICT' })
  })

  it('FULL success sweeps exactly stale frozen references while a failed snapshot never sweeps', async () => {
    const successful = await fullFixture(false)
    const successfulRepository = queue()
    const successfulClaim = await claim(successfulRepository, 'full-success')
    await expect(
      executeScan(context(successfulRepository, successfulClaim, successful.payload), dependencies(successful.root))
    ).resolves.toEqual(TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME)
    expect(await referenceExists(successful.currentExternalId)).toBe(true)
    expect(await referenceExists(successful.staleExternalId)).toBe(false)
    expect(await referenceExists(successful.futureExternalId)).toBe(true)

    const failed = await fullFixture(true)
    const failedRepository = queue()
    const failedClaim = await claim(failedRepository, 'full-failed')
    await expect(
      executeScan(context(failedRepository, failedClaim, failed.payload), dependencies(failed.root))
    ).resolves.toEqual(TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME)
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: failed.jobId } })).status).toBe('FAILED')
    expect(await referenceExists(failed.staleExternalId)).toBe(true)
  })

  it.each([
    ['CLIENT_LIST_SKIP', { mode: 'CLIENT_LIST', existingPolicy: 'SKIP' }],
    ['CLIENT_LIST_REFRESH', { mode: 'CLIENT_LIST', existingPolicy: 'REFRESH' }],
    ['ARTWORK_RESCAN', { mode: 'ARTWORK_RESCAN', artworkId: 1 }],
    ['FULL_RECONCILE', { mode: 'FULL_RECONCILE' }]
  ] as const)('persists first-seen inventory failures for %s snapshots', async (_label, partialPayload) => {
    const root = await fixtureRoot()
    const directory = path.join(root, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    const bytes = Buffer.from('{invalid json')
    await fs.writeFile(path.join(root, relativePath), bytes)
    const state = await statStableFile(path.join(await fs.realpath(root), relativePath))
    const row = {
      ordinal: 0,
      relativePath,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      ...state
    }
    const payload: ScanPayload =
      partialPayload.mode === 'CLIENT_LIST'
        ? { ...partialPayload, inputCount: 1, inputDigest: metadataInputDigest([row]) }
        : partialPayload
    const jobId = await seedJob('SCAN', payload, 1)
    await client().scanRun.create({
      data: {
        systemJobId: jobId,
        type: 'PIXIV',
        mode: payload.mode === 'CLIENT_LIST' ? 'CLIENT_LIST' : payload.mode === 'ARTWORK_RESCAN' ? 'RESCAN' : 'FULL',
        status: 'PENDING',
        inputFrozenAt: clock.now(),
        inputCount: 1,
        inputDigest: metadataInputDigest([row]),
        metadataInputs: { create: row }
      }
    })
    const repository = queue()
    const claimed = await claim(repository, `first-failure-${partialPayload.mode}`)
    await executeScan(context(repository, claimed, payload), dependencies(root))

    expect(await client().pixivMetadataInventory.findUniqueOrThrow({ where: { relativePath } })).toMatchObject({
      externalId,
      sizeBytes: state.sizeBytes,
      mtimeMs: state.mtimeMs,
      lastErrorCode: 'METADATA_INVALID',
      lastErrorRetryable: false
    })
  })

  it('releases an interrupted input without recording an inventory or checkpoint failure', async () => {
    const root = await fixtureRoot()
    const directory = path.join(root, 'pixiv')
    const externalId = nextNumericId()
    const relativePath = `pixiv/${externalId}-meta.json`
    await fs.mkdir(directory, { recursive: true })
    const bytes = Buffer.from(JSON.stringify(metadataDocument(externalId)))
    await fs.writeFile(path.join(root, relativePath), bytes)
    await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
    const state = await statStableFile(path.join(await fs.realpath(root), relativePath))
    const row = {
      ordinal: 0,
      relativePath,
      contentHash: createHash('sha256').update(bytes).digest('hex'),
      ...state
    }
    const payload: ScanPayload = {
      mode: 'CLIENT_LIST',
      existingPolicy: 'REFRESH',
      inputCount: 1,
      inputDigest: metadataInputDigest([row])
    }
    const jobId = await seedJob('SCAN', payload, 2)
    const run = await client().scanRun.create({
      data: {
        systemJobId: jobId,
        type: 'PIXIV',
        mode: 'CLIENT_LIST',
        status: 'PENDING',
        inputFrozenAt: clock.now(),
        inputCount: 1,
        inputDigest: payload.inputDigest,
        metadataInputs: { create: row }
      }
    })
    const interruption = new Error('worker shutdown during metadata read')
    let abortChecks = 0
    const signal = {
      get aborted() {
        abortChecks += 1
        return abortChecks >= 6
      },
      get reason() {
        return interruption
      }
    } as AbortSignal
    const repository = queue()
    const claimed = await claim(repository, 'input-shutdown')
    await executeScan(context(repository, claimed, payload, signal), dependencies(root))

    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('PENDING')
    expect(await client().scanRunItem.count({ where: { scanRunId: run.id } })).toBe(0)
    expect(await client().pixivMetadataInventory.count({ where: { relativePath } })).toBe(0)
    expect(await client().scanRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({
      failedInputs: null,
      parsedInputs: null,
      publishedInputs: null
    })
  })

  it('rejects missing or tampered CLIENT and LOCAL snapshots without publishing domain rows', async () => {
    const root = await fixtureRoot()
    await seedJob('SCAN', clientPayload('a'.repeat(64)), 1)
    const missingRepository = queue()
    const missingClaim = await claim(missingRepository, 'missing-client')
    await expect(
      executeScan(context(missingRepository, missingClaim, clientPayload('a'.repeat(64))), dependencies(root))
    ).rejects.toMatchObject({
      code: 'INPUT_SNAPSHOT_INVALID'
    })
    await missingRepository.fail({
      ...fence(missingClaim),
      errorCode: 'PRECONDITION_FAILED',
      error: 'Missing frozen snapshot'
    })

    const clientJob = await seedJob('SCAN', clientPayload('b'.repeat(64)), 1)
    await client().scanRun.create({
      data: {
        systemJobId: clientJob,
        type: 'PIXIV',
        mode: 'CLIENT_LIST',
        status: 'PENDING',
        inputFrozenAt: clock.now(),
        inputCount: 1,
        inputDigest: 'b'.repeat(64),
        metadataInputs: {
          create: { ordinal: 0, relativePath: 'tampered/1-meta.json', contentHash: 'c'.repeat(64) }
        }
      }
    })
    const clientRepository = queue()
    const clientClaim = await claim(clientRepository, 'tampered-client')
    await executeScan(context(clientRepository, clientClaim, clientPayload('b'.repeat(64))), dependencies(root))
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: clientJob } })).status).toBe('FAILED')

    const mappingDigest = artistMappingInputDigest([])
    const localJob = await seedJob(
      'LOCAL_DIRECTORY_IMPORT',
      { defaultTagIds: [], mappingCount: 0, mappingDigest } satisfies LocalDirectoryImportPayload,
      1
    )
    await client().scanRun.create({
      data: {
        systemJobId: localJob,
        type: 'LOCAL_IMPORT',
        mode: 'LOCAL_DIRECTORY_IMPORT',
        status: 'PENDING',
        inputFrozenAt: clock.now(),
        inputCount: 0,
        inputDigest: 'd'.repeat(64)
      }
    })
    const localRepository = queue()
    const localClaim = await claim(localRepository, 'tampered-local')
    await executeLocalDirectoryImport(
      context(localRepository, localClaim, { defaultTagIds: [], mappingCount: 0, mappingDigest }),
      dependencies(root)
    )
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: localJob } })).status).toBe('FAILED')
  })

  it.each([
    ['PAUSING', 'PAUSED'],
    ['CANCELLING', 'CANCELLED'],
    ['SHUTDOWN', 'PENDING']
  ] as const)('atomically maps executor control %s onto ScanRun and job %s', async (control, expectedStatus) => {
    const root = await fixtureRoot()
    const payload: LocalDirectoryImportPayload = {
      defaultTagIds: [],
      mappingCount: 0,
      mappingDigest: artistMappingInputDigest([])
    }
    const jobId = await seedJob('LOCAL_DIRECTORY_IMPORT', payload, 1)
    await client().scanRun.create({
      data: {
        systemJobId: jobId,
        type: 'LOCAL_IMPORT',
        mode: 'LOCAL_DIRECTORY_IMPORT',
        status: 'PENDING',
        inputFrozenAt: clock.now(),
        inputCount: 0,
        inputDigest: localWorkInputDigest([])
      }
    })
    const repository = queue()
    const claimed = await claim(repository, `control-${control}`)
    const controller = new AbortController()
    const executionContext = context(repository, claimed, payload, controller.signal)
    const originalMutate = executionContext.mutateInTransaction
    let mutations = 0
    executionContext.mutateInTransaction = (async (operation: (transaction: QueueSqlExecutor) => Promise<unknown>) => {
      const result = await originalMutate(operation)
      mutations += 1
      if (mutations === 1) {
        if (control === 'PAUSING') {
          await client().systemJob.update({
            where: { id: jobId },
            data: { status: 'PAUSING', pauseRequestedAt: clock.now() }
          })
        } else if (control === 'CANCELLING') {
          await client().systemJob.update({
            where: { id: jobId },
            data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
          })
        } else {
          controller.abort(new Error('worker shutdown'))
        }
      }
      return result
    }) as typeof executionContext.mutateInTransaction

    await executeLocalDirectoryImport(executionContext, dependencies(root))
    expect((await client().systemJob.findUniqueOrThrow({ where: { id: jobId } })).status).toBe(expectedStatus)
    expect((await client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })).status).toBe(expectedStatus)
  })
})

async function frozenArtworkRescanFixture(root: string, source: 'PIXIV_IMPORTED' | 'URL_ARCHIVE') {
  const directory = path.join(root, 'pixiv')
  const externalId = nextNumericId()
  const relativePath = `pixiv/${externalId}-meta.json`
  await fs.mkdir(directory, { recursive: true })
  const bytes = Buffer.from(JSON.stringify(metadataDocument(externalId)))
  await fs.writeFile(path.join(root, relativePath), bytes)
  await fs.writeFile(path.join(directory, `${externalId}_p0.jpg`), 'image')
  const state = await statStableFile(path.join(await fs.realpath(root), relativePath))
  const row = {
    ordinal: 0,
    relativePath,
    contentHash: createHash('sha256').update(bytes).digest('hex'),
    ...state
  }
  const artwork = await client().artwork.create({
    data: {
      title: `${testPrefix}-rescan-fixture-${externalId}`,
      externalId: `${testPrefix}-rescan-fixture-legacy-${externalId}`,
      source,
      createdVia: source === 'URL_ARCHIVE' ? 'URL_ARCHIVE' : 'PIXIV_SCAN',
      metaSource: relativePath
    }
  })
  await client().artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      providerKey: 'pixiv',
      externalId,
      canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
      locator: { artworkId: externalId }
    }
  })
  const payload: ScanPayload = { mode: 'ARTWORK_RESCAN', artworkId: artwork.id }
  const jobId = await seedJob('SCAN', payload, 1)
  const run = await client().scanRun.create({
    data: {
      systemJobId: jobId,
      type: 'PIXIV',
      mode: 'RESCAN',
      status: 'PENDING',
      inputFrozenAt: clock.now(),
      inputCount: 1,
      inputDigest: metadataInputDigest([row]),
      metadataInputs: { create: row }
    }
  })
  return { artwork, externalId, jobId, payload, relativePath, row, run }
}

async function fullFixture(tampered: boolean) {
  const root = await fixtureRoot()
  const currentExternalId = nextNumericId()
  const staleExternalId = nextNumericId()
  const futureExternalId = nextNumericId()
  const directory = path.join(root, 'pixiv')
  await fs.mkdir(directory, { recursive: true })
  const document = Buffer.from(JSON.stringify(metadataDocument(currentExternalId)))
  await fs.writeFile(path.join(directory, `${currentExternalId}-meta.json`), document)
  await fs.writeFile(path.join(directory, `${currentExternalId}_p0.jpg`), 'image')
  const contentHash = createHash('sha256').update(document).digest('hex')
  const relativePath = `pixiv/${currentExternalId}-meta.json`
  const frozenAt = clock.now()
  const row = { ordinal: 0, relativePath, contentHash: tampered ? 'f'.repeat(64) : contentHash }
  const payload: ScanPayload = { mode: 'FULL_RECONCILE' }
  const jobId = await seedJob('SCAN', payload, 1)
  await client().scanRun.create({
    data: {
      systemJobId: jobId,
      type: 'PIXIV',
      mode: 'FULL',
      status: 'PENDING',
      inputFrozenAt: frozenAt,
      inputCount: 1,
      inputDigest: metadataInputDigest([row]),
      metadataInputs: { create: { ...row } }
    }
  })
  await createReferencedArtwork(currentExternalId, new Date(frozenAt.getTime() - 2_000))
  await createReferencedArtwork(staleExternalId, new Date(frozenAt.getTime() - 1_000))
  await createReferencedArtwork(futureExternalId, new Date(frozenAt.getTime() + 1_000))
  return { root, jobId, payload, currentExternalId, staleExternalId, futureExternalId }
}

async function createReferencedArtwork(externalId: string, createdAt: Date) {
  const artwork = await client().artwork.create({
    data: { title: `${testPrefix}-${externalId}`, externalId, source: 'PIXIV_IMPORTED', createdVia: 'PIXIV_SCAN' }
  })
  await client().artworkExternalRef.create({
    data: {
      artworkId: artwork.id,
      providerKey: 'pixiv',
      externalId,
      canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
      locator: { artworkId: externalId },
      createdAt
    }
  })
}

async function referenceExists(externalId: string) {
  return Boolean(
    await client().artworkExternalRef.findUnique({
      where: { providerKey_externalId: { providerKey: 'pixiv', externalId } }
    })
  )
}

interface AuditApplyFixture {
  root: string
  externalId: string
  relativePath: string
  contentHash: string
  state: Awaited<ReturnType<typeof statStableFile>>
  inventoryId: string
  auditRunId: string
  sourceAuditItemId: string
  differenceKind: 'NEW' | 'CHANGED'
  expectedProcessedContentHash: string | null
  expectedExternalRefId: string | null
  expectedArtworkId: number | null
  jobId: string
  applyRunId: string
  payload: ScanAuditApplyPayload
}

async function seedAuditApplyFixture(options: {
  includeMedia: boolean
  maxAttempts?: number
  differenceKind?: 'NEW' | 'CHANGED'
}): Promise<AuditApplyFixture> {
  const root = await fixtureRoot()
  const externalId = nextNumericId()
  const relativePath = `audit-apply/${externalId}-meta.json`
  const absolutePath = path.join(root, relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  const bytes = Buffer.from(JSON.stringify(metadataDocument(externalId)))
  await fs.writeFile(absolutePath, bytes)
  if (options.includeMedia) {
    await fs.writeFile(path.join(path.dirname(absolutePath), `${externalId}_p0.jpg`), 'media')
  }
  const state = await statStableFile(path.join(await fs.realpath(root), relativePath))
  const contentHash = createHash('sha256').update(bytes).digest('hex')
  await seedReadyAuditState(root)
  const differenceKind = options.differenceKind ?? 'NEW'
  const expectedProcessedContentHash = differenceKind === 'CHANGED' ? 'd'.repeat(64) : null
  const existingArtwork =
    differenceKind === 'CHANGED'
      ? await client().artwork.create({
          data: {
            title: `${testPrefix}-curated-${externalId}`,
            titleOverridden: true,
            externalId: `${testPrefix}-legacy-${externalId}`,
            metaSource: relativePath,
            source: 'PIXIV_IMPORTED',
            createdVia: 'PIXIV_SCAN'
          }
        })
      : null
  const existingRef = existingArtwork
    ? await client().artworkExternalRef.create({
        data: {
          artworkId: existingArtwork.id,
          providerKey: 'pixiv',
          externalId,
          canonicalUrl: `https://www.pixiv.net/artworks/${externalId}`,
          locator: { artworkId: externalId },
          metadataHash: expectedProcessedContentHash
        }
      })
    : null
  const inventory = await client().pixivMetadataInventory.create({
    data: {
      relativePath,
      externalId,
      ...state,
      observedContentHash: contentHash,
      processedContentHash: expectedProcessedContentHash,
      lastAttemptedContentHash: contentHash,
      externalRefId: existingRef?.id ?? null,
      baselineGeneration: 1,
      lastAttemptedAt: clock.now()
    }
  })
  const auditJobId = await seedJob('SCAN', { mode: 'CONSISTENCY_AUDIT', verification: 'FAST' }, 1, 2)
  await client().systemJob.update({
    where: { id: auditJobId },
    data: { status: 'COMPLETED', startedAt: clock.now(), finishedAt: clock.now(), progress: 100 }
  })
  const auditRun = await client().scanRun.create({
    data: {
      systemJobId: auditJobId,
      type: 'PIXIV',
      mode: 'INCREMENTAL',
      status: 'COMPLETED',
      operationKind: 'CONSISTENCY_AUDIT',
      inputCount: 1,
      inputFrozenAt: clock.now(),
      inventoryBaselineGeneration: 1,
      startedAt: clock.now(),
      finishedAt: clock.now(),
      checkpointStage: 'COMPLETED',
      auditNewInputs: differenceKind === 'NEW' ? 1 : 0,
      auditChangedInputs: differenceKind === 'CHANGED' ? 1 : 0,
      auditInvalidInputs: 0,
      auditIdentityConflictInputs: 0,
      missingInputs: 0,
      inventoryUnchanged: 0
    }
  })
  const sourceItem = await client().pixivSourceAuditItem.create({
    data: {
      scanRunId: auditRun.id,
      ordinal: 0,
      differenceKind,
      relativePath,
      expectedExternalId: externalId,
      observedExternalId: externalId,
      title: `${testPrefix}-${externalId}`,
      artistName: `${testPrefix}-artist`,
      inventoryId: inventory.id,
      externalRefId: existingRef?.id ?? null,
      artworkId: existingArtwork?.id ?? null,
      observedContentHash: contentHash,
      processedContentHash: expectedProcessedContentHash,
      ...state
    }
  })
  return seedApplyOperationFromAudit(
    {
      root,
      externalId,
      relativePath,
      contentHash,
      state,
      inventoryId: inventory.id,
      auditRunId: auditRun.id,
      sourceAuditItemId: sourceItem.id,
      differenceKind,
      expectedProcessedContentHash,
      expectedExternalRefId: existingRef?.id ?? null,
      expectedArtworkId: existingArtwork?.id ?? null
    },
    options.maxAttempts
  )
}

async function seedApplyOperationFromAudit(
  source: Omit<AuditApplyFixture, 'jobId' | 'applyRunId' | 'payload'>,
  maxAttempts = 1
): Promise<AuditApplyFixture> {
  const evidence: AuditApplyInputEvidence = {
    ordinal: 0,
    sourceAuditItemId: source.sourceAuditItemId,
    auditDifferenceKind: source.differenceKind,
    relativePath: source.relativePath,
    expectedExternalId: source.externalId,
    observedExternalId: source.externalId,
    expectedInventoryId: source.inventoryId,
    expectedExternalRefId: source.expectedExternalRefId,
    expectedArtworkId: source.expectedArtworkId,
    observedContentHash: source.contentHash,
    processedContentHash: source.expectedProcessedContentHash,
    ...source.state
  }
  const inputDigest = createHash('sha256')
    .update(canonicalizeAuditApplyInputs(source.auditRunId, [evidence]))
    .digest('hex')
  const payload: ScanAuditApplyPayload = {
    mode: 'AUDIT_APPLY',
    auditRunId: source.auditRunId,
    inputCount: 1,
    inputDigest
  }
  const jobId = await seedJob('SCAN', payload, maxAttempts, 3)
  const run = await client().scanRun.create({
    data: {
      systemJobId: jobId,
      type: 'PIXIV',
      mode: 'INCREMENTAL',
      status: 'PENDING',
      operationKind: 'AUDIT_APPLY',
      sourceAuditRunId: source.auditRunId,
      inputCount: 1,
      inputDigest,
      inputFrozenAt: clock.now(),
      inventoryBaselineGeneration: 1,
      checkpointStage: 'QUEUED',
      totalArtworks: 1,
      auditNewInputs: source.differenceKind === 'NEW' ? 1 : 0,
      auditChangedInputs: source.differenceKind === 'CHANGED' ? 1 : 0,
      auditApplyStaleInputs: 0,
      auditApplyConflictInputs: 0,
      metadataInputs: {
        create: {
          ordinal: 0,
          relativePath: source.relativePath,
          contentHash: source.contentHash,
          sourceAuditItemId: source.sourceAuditItemId,
          auditDifferenceKind: source.differenceKind,
          expectedExternalId: source.externalId,
          observedExternalId: source.externalId,
          expectedInventoryId: source.inventoryId,
          expectedExternalRefId: source.expectedExternalRefId,
          expectedArtworkId: source.expectedArtworkId,
          expectedProcessedContentHash: source.expectedProcessedContentHash,
          ...source.state
        }
      },
      items: {
        create: {
          checkpointKey: `audit-apply:${source.sourceAuditItemId}`,
          sourceAuditItemId: source.sourceAuditItemId,
          auditDifferenceKind: source.differenceKind,
          externalId: source.externalId,
          title: `${testPrefix}-${source.externalId}`,
          artistName: `${testPrefix}-artist`,
          metadataRelativePath: source.relativePath,
          status: 'PENDING',
          action: source.differenceKind === 'NEW' ? 'CREATE' : 'UPDATE'
        }
      }
    }
  })
  return { ...source, jobId, applyRunId: run.id, payload }
}

function dependencies(root: string): ScanExecutorDependencies {
  return {
    database: client() as unknown as ScanDatabase,
    config: {
      scanRoot: root,
      limits: {
        pageSize: 2,
        maxDepth: 8,
        maxEntries: 100,
        maxMediaPerArtwork: 10,
        concurrency: 2,
        maxMetadataBytes: 32_000,
        maxArchiveMediaBytes: 32_000,
        maxFullSweepReferences: 100
      }
    },
    now: () => clock.now()
  }
}

function context<TPayload extends ScanPayload | ScanV2Payload | ScanAuditApplyPayload | LocalDirectoryImportPayload>(
  repository: PostgresQueueRepository,
  job: ClaimedJob,
  payload: TPayload,
  signal = new AbortController().signal
): ExecutionContext<TPayload, EnqueuedChildJob> {
  const ownedFence = fence(job)
  return {
    job,
    payload,
    signal,
    progress: vi.fn(async () => undefined),
    enqueueChild: vi.fn(async () => {
      throw new Error('not used')
    }),
    mutateInTransaction: (operation) => repository.withFencedMutationTransaction(ownedFence, operation),
    finalizeInTransaction: async (operation) => {
      await repository.withFencedExecutionTransaction(ownedFence, operation)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  }
}

function queue() {
  return new PostgresQueueRepository(client() as unknown as QueueDatabase, {
    clock,
    leaseDurationMs: 60_000,
    transactionMaxWaitMs: 5_000,
    transactionTimeoutMs: 20_000
  })
}

async function claim(repository: PostgresQueueRepository, suffix: string) {
  const claimed = await repository.claim(`${testPrefix}-${suffix}`, capabilities)
  if (!claimed) throw new Error('Expected the fixture job to be claimed')
  return claimed
}

function fence(job: ClaimedJob): ExecutionFence {
  return { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
}

async function seedJob(
  type: 'SCAN' | 'LOCAL_DIRECTORY_IMPORT',
  payload: unknown,
  maxAttempts: number,
  definitionVersion = 1
) {
  const id = `${testPrefix}-${randomUUID()}`
  await client().systemJob.create({
    data: {
      id,
      type,
      definitionVersion,
      status: 'PENDING',
      triggerSource: 'MANUAL',
      payload: payload as never,
      queuePriority: 0,
      effectivePriority: 0,
      availableAt: clock.now(),
      maxAttempts
    }
  })
  return id
}

function clientPayload(inputDigest: string): Extract<ScanPayload, { mode: 'CLIENT_LIST' }> {
  return { mode: 'CLIENT_LIST', existingPolicy: 'REFRESH', inputCount: 1, inputDigest }
}

function metadata(externalId: string) {
  return {
    id: externalId,
    user: `${testPrefix}-artist`,
    userId: externalId,
    title: `${testPrefix}-${externalId}`,
    description: null,
    tags: [],
    url: `https://www.pixiv.net/artworks/${externalId}`,
    original: null,
    thumbnail: null,
    xRestrict: null,
    isAiGenerated: null,
    size: null,
    bookmarkCount: null,
    sourceDate: null,
    metadataFormat: 'json' as const,
    rawMetadataJson: null,
    pixivAiType: null,
    pixivType: null,
    sanityLevel: null
  }
}

function media(relativePath: string, sortOrder: number) {
  return {
    relativePath,
    size: 5n,
    sortOrder,
    mediaType: 'IMAGE' as const,
    webpAnimationStatus: null,
    chaptersPath: null,
    chaptersCount: 0,
    chaptersDuration: null,
    chaptersHash: null
  }
}

function metadataDocument(externalId: string) {
  return {
    id: externalId,
    user: `${testPrefix}-artist`,
    userId: externalId,
    title: `${testPrefix}-${externalId}`,
    tags: []
  }
}

function nextNumericId() {
  numericId += 1
  return String(numericId)
}

async function fixtureRoot() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'pixishelf-scan-pg-'))
  roots.push(root)
  return root
}

async function cleanup() {
  if (!prisma) return
  await prisma.pixivMetadataInventory.deleteMany()
  await prisma.pixivMetadataInventoryState.deleteMany()
  await prisma.scanRun.deleteMany({ where: { systemJobId: { startsWith: testPrefix } } })
  await prisma.jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: testPrefix } } })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: testPrefix } } })
  await prisma.artwork.deleteMany({ where: { title: { startsWith: testPrefix } } })
  await prisma.artist.deleteMany({ where: { name: { startsWith: testPrefix } } })
  await prisma.tag.deleteMany({ where: { name: { startsWith: testPrefix } } })
}

async function galleryDomainCounts() {
  const [artworks, images, externalRefs, tags, series, sourceSnapshots, rawMetadata, artworkTags] = await Promise.all([
    client().artwork.count(),
    client().image.count(),
    client().artworkExternalRef.count(),
    client().tag.count(),
    client().series.count(),
    client().artworkSourceSnapshot.count(),
    client().artworkRawMetadata.count(),
    client().artworkTag.count()
  ])
  return { artworks, images, externalRefs, tags, series, sourceSnapshots, rawMetadata, artworkTags }
}

async function seedReadyAuditState(root: string) {
  const identity = await resolveSafeScanRoot(root)
  return client().pixivMetadataInventoryState.create({
    data: {
      id: 'pixiv',
      status: 'READY',
      rootPathHash: hashScanRootIdentity(identity.absolutePath),
      rootDeviceId: identity.deviceId,
      rootInode: identity.inode,
      baselineCompletedAt: clock.now()
    }
  })
}

async function seedMissingAuditInventory(relativePath: string) {
  return client().pixivMetadataInventory.create({
    data: {
      relativePath,
      externalId: relativePath.match(/(\d+)-meta/)?.[1] ?? nextNumericId(),
      sizeBytes: 1n,
      mtimeMs: 1n,
      observedContentHash: 'd'.repeat(64),
      processedContentHash: 'd'.repeat(64),
      lastAttemptedContentHash: 'd'.repeat(64),
      createdAt: clock.now()
    }
  })
}

async function executeIncremental(root: string, suffix: string) {
  const payload: ScanPayload = { mode: 'INCREMENTAL' }
  const jobId = await seedJob('SCAN', payload, 1)
  const repository = queue()
  const claimed = await claim(repository, suffix)
  await expect(executeScan(context(repository, claimed, payload), dependencies(root))).resolves.toEqual(
    TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
  )
  return client().scanRun.findUniqueOrThrow({ where: { systemJobId: jobId } })
}

function client() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is not configured')
  return prisma
}

function concurrentClient() {
  if (!concurrentPrisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is not configured')
  return concurrentPrisma
}

function afterPixivSourceLookup(transaction: ScanTransaction, afterRead: () => Promise<void>): ScanTransaction {
  const externalRefs = transaction.artworkExternalRef
  let intercepted = false
  const coordinatedExternalRefs = new Proxy(externalRefs, {
    get(target, property) {
      if (property === 'findUnique') {
        return async (...args: Parameters<typeof externalRefs.findUnique>) => {
          const result = await externalRefs.findUnique(...args)
          if (!intercepted) {
            intercepted = true
            await afterRead()
          }
          return result
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property === 'artworkExternalRef') return coordinatedExternalRefs
      return Reflect.get(target, property, receiver)
    }
  })
}

function trackAuditItemBatches(
  transaction: ScanTransaction & QueueSqlExecutor,
  batchSizes: number[]
): ScanTransaction & QueueSqlExecutor {
  const auditItems = transaction.pixivSourceAuditItem
  const trackedAuditItems = new Proxy(auditItems, {
    get(target, property) {
      if (property === 'create') {
        return () => {
          throw new Error('Final MISSING audit items must use bounded createMany batches')
        }
      }
      if (property === 'createMany') {
        return (args: Prisma.PixivSourceAuditItemCreateManyArgs) => {
          batchSizes.push(Array.isArray(args.data) ? args.data.length : 1)
          return target.createMany(args)
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property === 'pixivSourceAuditItem') return trackedAuditItems
      return Reflect.get(target, property, receiver)
    }
  })
}

function afterExternalRefLock(transaction: ScanTransaction, afterLock: () => Promise<void>): ScanTransaction {
  const externalRefs = transaction.artworkExternalRef
  let intercepted = false
  const coordinatedExternalRefs = new Proxy(externalRefs, {
    get(target, property) {
      if (property === 'updateMany') {
        return async (...args: Parameters<typeof externalRefs.updateMany>) => {
          const result = await externalRefs.updateMany(...args)
          if (!intercepted) {
            intercepted = true
            await afterLock()
          }
          return result
        }
      }
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    }
  })
  return new Proxy(transaction, {
    get(target, property, receiver) {
      if (property === 'artworkExternalRef') return coordinatedExternalRefs
      return Reflect.get(target, property, receiver)
    }
  })
}
