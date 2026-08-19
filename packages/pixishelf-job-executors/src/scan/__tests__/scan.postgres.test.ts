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
import { executeLocalDirectoryImport } from '../local-executor.js'
import { publishPixivArtwork } from '../pixiv-publisher.js'
import { executeScan } from '../scan-executor.js'
import type { ScanDatabase, ScanExecutorDependencies, ScanTransaction } from '../types.js'

const databaseUrl =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe.sequential : describe.skip
const prisma = databaseUrl ? new PrismaClient({ datasourceUrl: databaseUrl }) : null
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
    await prisma?.$disconnect()
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
  await prisma.scanRun.deleteMany({ where: { systemJobId: { startsWith: testPrefix } } })
  await prisma.jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: testPrefix } } })
  await prisma.systemJob.deleteMany({ where: { id: { startsWith: testPrefix } } })
  await prisma.artwork.deleteMany({ where: { title: { startsWith: testPrefix } } })
  await prisma.artist.deleteMany({ where: { name: { startsWith: testPrefix } } })
}

function client() {
  if (!prisma) throw new Error('QUEUE_KERNEL_TEST_DATABASE_URL is not configured')
  return prisma
}
