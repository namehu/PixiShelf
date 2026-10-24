// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import * as fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  PostgresQueueRepository,
  TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME,
  type ClaimedJob,
  type QueueDatabase,
  type ExecutionContext,
  type EnqueuedChildJob
} from '@pixishelf/job-runtime'
import type { ArtworkDedupScanPayload, ArtworkDedupMaintenancePayload } from '@pixishelf/job-contracts'
import { executeArtworkDedup } from '../../../pixishelf-job-executors/src/artwork-dedup/executor'
import { executeArtworkDedupMaintenance } from '../../../pixishelf-job-executors/src/artwork-dedup/maintenance-executor'
import type { Context } from '@/server/context'
vi.mock('@/lib/prisma', async () => {
  const { PrismaClient } = await import('@pixishelf/db')
  return {
    prisma: new PrismaClient({
      datasourceUrl: process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? 'postgresql://unused:unused@127.0.0.1:1/unused'
    })
  }
})
import type { PrismaClient } from '@pixishelf/db'
import { prisma as applicationPrisma } from '@/lib/prisma'
// The module mock above supplies a plain, explicitly isolated PrismaClient.
const db = applicationPrisma as unknown as PrismaClient
import { artworkDedupRouter } from '@/server/routers/artwork-dedup'
const enabled = !!process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const prefix = `dedup-stage3-api-${randomUUID()}`
const repository = new PostgresQueueRepository(db as unknown as QueueDatabase, { transactionTimeoutMs: 20000 })
const workerRequire = createRequire(new URL('../../../pixishelf-worker/package.json', import.meta.url))
const readerOptions = {
  entrypoint: new URL('../../../pixishelf-job-executors/src/artwork-dedup/reader-child.ts', import.meta.url).pathname,
  execArgv: ['--import', workerRequire.resolve('tsx')]
}
const jobs: string[] = [],
  runs: string[] = [],
  artworks: number[] = []
let root: string, artistId: number
const context = {
  headers: new Headers({ 'x-forwarded-for': prefix }),
  user: { id: prefix },
  userId: prefix,
  session: { id: `${prefix}-session`, userId: prefix }
} as Context
const caller = artworkDedupRouter.createCaller(context)
const fence = (job: ClaimedJob) => ({
  jobId: job.id,
  workerId: job.workerId,
  executionToken: job.executionToken,
  attempt: job.attempt
})
function executionContext<T>(job: ClaimedJob): ExecutionContext<T, EnqueuedChildJob> {
  return {
    job,
    payload: job.payload as T,
    signal: new AbortController().signal,
    progress: (update) => repository.updateProgress({ ...fence(job), ...update }),
    enqueueChild: async () => {
      throw new Error('Unexpected child')
    },
    mutateInTransaction: (body) => repository.withFencedMutationTransaction(fence(job), body),
    finalizeInTransaction: async (body) => {
      await repository.withFencedExecutionTransaction(fence(job), body)
      return TRANSACTIONALLY_FINALIZED_EXECUTION_OUTCOME
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} }
  }
}
const dependencies = () => ({ database: db, sourceRoot: root, archiveRoot: root, readerOptions })
async function executePrepare(jobId: string) {
  const job = await repository.claim(prefix, [
    { jobType: 'ARTWORK_DEDUP_MAINTENANCE', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
  ])
  expect(job?.id).toBe(jobId)
  await executeArtworkDedupMaintenance(executionContext<ArtworkDedupMaintenancePayload>(job!), dependencies())
}
describe.skipIf(!enabled)('stage three real API-to-queue preview integration', () => {
  beforeAll(async () => {
    root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'dedup-stage3-api-')))
    await db.userBA.create({ data: { id: prefix, name: 'fixture', email: `${prefix}@test.invalid` } })
    artistId = (await db.artist.create({ data: { name: prefix } })).id
    for (let n = 0; n < 2; n++) {
      const directory = `work-${n}`
      await fs.mkdir(path.join(root, directory))
      await fs.writeFile(path.join(root, directory, 'cover.jpg'), Buffer.alloc(8, 7))
      const art = await db.artwork.create({
        data: {
          title: `${prefix}-${n}`,
          createdVia: 'LOCAL_DIRECTORY',
          storagePath: directory,
          storageKey: `${prefix}-${n}`,
          creators: { create: { artistId, evidence: { create: { evidenceKey: 'manual', provenance: 'MANUAL' } } } },
          images: { create: { path: `${directory}/cover.jpg`, size: 8n } }
        }
      })
      artworks.push(art.id)
    }
  })
  afterAll(async () => {
    if (!enabled) return
    const identities = (
      await db.artworkDedupMedia.findMany({
        where: { runId: { in: runs } },
        distinct: ['rootIdentity'],
        select: { rootIdentity: true }
      })
    ).map((row) => row.rootIdentity)
    await db.artworkDedupOperation.deleteMany({ where: { runId: { in: runs } } })
    await db.artworkDedupRun.deleteMany({ where: { id: { in: runs } } })
    await db.image.deleteMany({ where: { artworkId: { in: artworks } } })
    await db.artwork.deleteMany({ where: { id: { in: artworks } } })
    await db.systemJob.deleteMany({ where: { id: { in: jobs } } })
    await db.artist.deleteMany({ where: { id: artistId } })
    await db.userBA.deleteMany({ where: { id: prefix } })
    await db.mediaContentPathWrite.deleteMany({ where: { directory: { rootIdentity: { in: identities } } } })
    await db.mediaContentDirectoryState.deleteMany({ where: { rootIdentity: { in: identities } } })
    await db.$disconnect()
    await fs.rm(root, { recursive: true, force: true })
  })
  it('publishes READY, persists refresh/idempotency, blocks unknown files, and rejects higher stages', async () => {
    const start = await caller.start({ artistId, expectedUserId: prefix, mode: 'FULL', idempotencyKey: randomUUID() })
    runs.push(start.runId)
    jobs.push(start.jobId!)
    const scan = await repository.claim(prefix, [
      { jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
    ])
    expect(scan?.id).toBe(start.jobId)
    await executeArtworkDedup(executionContext<ArtworkDedupScanPayload>(scan!), dependencies())
    const run = await caller.getRun({ runId: start.runId, expectedUserId: prefix })
    expect(run?.status).toBe('COMPLETED')
    const groups = await caller.listGroups({ runId: start.runId, expectedUserId: prefix, limit: 20 })
    expect(groups.allowedActions).toEqual(['SAVE_REVIEW', 'PREPARE_CLEANUP'])
    const input = {
      runId: start.runId,
      expectedUserId: prefix,
      expectedRunVersion: run!.version,
      expectedReviewRevision: groups.reviewRevision,
      idempotencyKey: randomUUID(),
      selection: { kind: 'ALL_RECOMMENDED' as const, excludedGroupIds: [] }
    }
    const anonymous = artworkDedupRouter.createCaller({
      ...context,
      user: undefined,
      userId: undefined,
      session: undefined
    })
    await expect(anonymous.prepareCleanup(input)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(caller.prepareCleanup({ ...input, expectedUserId: 'switched' })).rejects.toMatchObject({
      code: 'FORBIDDEN'
    })
    const operation = await caller.prepareCleanup(input)
    jobs.push(operation.jobId!)
    expect(operation.status).toBe('BUILDING')
    expect((await caller.prepareCleanup(input)).operationId).toBe(operation.operationId)
    expect(await db.systemJob.count({ where: { id: operation.jobId! } })).toBe(1)
    expect(await db.systemJob.findUnique({ where: { id: operation.jobId! } })).toMatchObject({
      triggerSource: 'SYSTEM',
      queuePriority: 900,
      executionLane: 'BACKGROUND_WRITER'
    })
    await executePrepare(operation.jobId!)
    const ready = await caller.getOperation({
      operationId: operation.operationId,
      expectedUserId: prefix,
      preview: { kind: 'ARTWORKS', limit: 20 }
    })
    expect(ready.operation).toMatchObject({
      status: 'READY',
      counts: { preparedFiles: '2', logicalBytes: '8', keepers: 1, copies: 1 },
      allowedActions: []
    })
    expect(ready.preview?.kind).toBe('ARTWORKS')
    const refreshed = artworkDedupRouter.createCaller({ ...context, headers: new Headers(context.headers) })
    expect(
      (await refreshed.getOperation({ operationId: operation.operationId, expectedUserId: prefix })).operation
    ).toEqual(ready.operation)
    expect((await refreshed.prepareCleanup(input)).operationId).toBe(operation.operationId)
    expect(
      (await refreshed.listOperations({ expectedUserId: prefix, artistId, limit: 20 })).items[0]?.operationId
    ).toBe(operation.operationId)
    await expect(
      refreshed.getOperation({ operationId: operation.operationId, expectedUserId: 'switched' })
    ).rejects.toMatchObject({ code: 'FORBIDDEN' })
    const command = {
        operationId: operation.operationId,
        expectedUserId: prefix,
        expectedVersion: ready.operation.version,
        idempotencyKey: randomUUID()
      },
      confirmation = {
        externalWritesStopped: true as const,
        backupCheckpointConfirmed: true as const,
        backupCheckpointRef: 'fixture-backup'
      },
      selection = { kind: 'ALL' as const }
    for (const result of [
      caller.isolate({ ...command, ...confirmation }),
      caller.restore({ ...command, selection }),
      caller.preparePurge({ ...command, selection }),
      caller.purge({
        ...command,
        ...confirmation,
        selection,
        permanentDeleteConfirmed: true,
        expectedPurgePreviewVersion: 1
      }),
      caller.allowReimport({ ...command, sources: [{ sourceId: 'fixture-source', expectedGeneration: '0' }] })
    ])
      {await expect(result).rejects.toMatchObject({ code: 'FORBIDDEN' })}
    const copy = await db.artworkDedupOperationArtwork.findFirstOrThrow({
      where: { operationId: operation.operationId, role: 'COPY' }
    })
    const directory = (await db.artwork.findUniqueOrThrow({ where: { id: copy.artworkId } })).storagePath!
    await fs.writeFile(path.join(root, directory, 'unreviewed.txt'), 'fixture attachment')
    const blocked = await caller.prepareCleanup({ ...input, idempotencyKey: randomUUID() })
    jobs.push(blocked.jobId!)
    await executePrepare(blocked.jobId!)
    const result = await caller.getOperation({
      operationId: blocked.operationId,
      expectedUserId: prefix,
      preview: { kind: 'FILES', artworkId: copy.artworkId, limit: 20 }
    })
    expect(result.operation).toMatchObject({
      status: 'FAILED',
      counts: { logicalBytes: null },
      failure: { code: 'INVENTORY_BLOCKED' }
    })
    expect(
      result.preview?.kind === 'FILES' &&
        result.preview.items.some((file) => file.status === 'BLOCKED' && file.requiresReview)
    ).toBe(true)
    expect(result.operation.allowedActions).not.toContain('ISOLATE')
    expect((await db.systemJob.findUniqueOrThrow({ where: { id: blocked.jobId! } })).status).toBe('COMPLETED')
    expect(await fs.readFile(path.join(root, directory, 'cover.jpg'))).toEqual(Buffer.alloc(8, 7))
  }, 30000)
})
