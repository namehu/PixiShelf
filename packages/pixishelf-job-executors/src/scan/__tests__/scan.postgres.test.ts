import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { LocalDirectoryImportPayload, ScanPayload, WorkerCapability } from '@pixishelf/job-contracts'
import { PrismaClient } from '@pixishelf/db'
import {
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
import { statStableFile } from '../content-reader.js'
import { hashScanRootIdentity } from '../inventory.js'
import {
  freezeIncrementalInventorySnapshot,
  recordExistingInventoryDecision,
  recordPublishedInventory
} from '../inventory-run.js'
import { executeLocalDirectoryImport } from '../local-executor.js'
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
  { jobType: 'SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] },
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
        root: { absolutePath: await fs.realpath(root) },
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
      root: { absolutePath: await fs.realpath(root) },
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
    const safeRoot = { absolutePath: await fs.realpath(root) }

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
        root: { absolutePath: await fs.realpath(root) },
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
    expect(
      await client().artworkExternalRef.count({
        where: { providerKey: 'pixiv', externalId }
      })
    ).toBe(1)
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
            lastAttemptedContentHash: contentHash
          })
        })
      )
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
  }, 30_000)

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

function context<TPayload extends ScanPayload | LocalDirectoryImportPayload>(
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

async function seedJob(type: 'SCAN' | 'LOCAL_DIRECTORY_IMPORT', payload: unknown, maxAttempts: number) {
  const id = `${testPrefix}-${randomUUID()}`
  await client().systemJob.create({
    data: {
      id,
      type,
      definitionVersion: 1,
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
