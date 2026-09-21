// @vitest-environment node
import { randomUUID } from 'node:crypto'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaClient, type Prisma } from '@pixishelf/db'
import { discoveryBatchPayloadSchema, parseDiscoveryBatchCheckpoint } from '@pixishelf/job-contracts'
import { executeDiscoveryBatch } from '@pixishelf/job-executors'
import {
  MutableQueueClock,
  PostgresQueueRepository,
  type ClaimedJob,
  type QueueDatabase,
  type QueueSqlExecutor
} from '@pixishelf/job-runtime'
import {
  startDiscoveryBatch,
  getDiscoveryBatch,
  commandDiscoveryBatch,
  retryDiscoveryBatch
} from '../discovery-batch-service'
import { pauseJobCommand, cancelJobCommand } from '@/services/background-task/job-command-service'

const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const suite = url ? describe.sequential : describe.skip
const prefix = `discovery-batch-test-${randomUUID()}`
const parentCaps = [
  {
    jobType: 'ARCHIVE_DISCOVERY_BATCH_SCAN' as const,
    executionLane: 'ARCHIVE_RESOLVE' as const,
    definitionVersions: [1]
  }
]
const childCaps = [
  { jobType: 'ARCHIVE_UPLOADER_SCAN' as const, executionLane: 'ARCHIVE_RESOLVE' as const, definitionVersions: [1] }
]
const clock = new MutableQueueClock(new Date())
const repository = () =>
  new PostgresQueueRepository(db! as unknown as QueueDatabase, {
    clock,
    leaseDurationMs: 60_000,
    transactionTimeoutMs: 20_000
  })
const fence = (job: ClaimedJob) => ({
  jobId: job.id,
  workerId: job.workerId,
  executionToken: job.executionToken,
  attempt: job.attempt
})

async function cleanup() {
  if (!db) return
  const jobs = await db.systemJob.findMany({
    where: { OR: [{ requestedByUserId: prefix }, { parentJob: { requestedByUserId: prefix } }] },
    select: { id: true }
  })
  const ids = jobs.map(({ id }) => id)
  await db.jobResourceLease.deleteMany({ where: { ownerJobId: { in: ids } } })
  await db.archiveUploaderScanRun.deleteMany({ where: { sourceId: { startsWith: prefix } } })
  await db.systemJob.deleteMany({ where: { id: { in: ids } } })
  await db.archiveUploaderSource.deleteMany({ where: { id: { startsWith: prefix } } })
}

async function source(suffix = 'a') {
  return db!.archiveUploaderSource.create({
    data: {
      id: `${prefix}-${suffix}`,
      providerKey: 'e-hentai',
      identityKind: 'UID',
      identityValue: `${prefix}-${suffix}`,
      normalizedIdentity: `${prefix}-${suffix}`,
      displayName: suffix
    }
  })
}
async function batch(ids: string[]) {
  return startDiscoveryBatch({ sourceIds: ids, requestId: randomUUID() }, prefix, db!)
}
async function runParent(injectRollback = false) {
  clock.advance(2000)
  const repo = repository()
  const claimed = await repo.claim(`${prefix}-worker`, 'ARCHIVE_RESOLVE', parentCaps)
  expect(claimed).toBeTruthy()
  const payload = discoveryBatchPayloadSchema.parse(claimed!.payload)
  const context = {
    job: claimed!,
    payload,
    signal: new AbortController().signal,
    finalizeInTransaction: (operation: (scope: unknown) => Promise<void>) =>
      repo.withFencedExecutionTransaction(fence(claimed!), async (scope) => {
        await operation(scope)
        if (injectRollback) throw new Error('injected rollback')
      })
  }
  await executeDiscoveryBatch(context as unknown as Parameters<typeof executeDiscoveryBatch>[0], {
    now: () => clock.now()
  })
  return claimed!
}
async function finishChild(historyCursor: string | null, incrementalCursor: string | null = null, failure = false) {
  const repo = repository()
  const child = await repo.claim(`${prefix}-worker`, 'ARCHIVE_RESOLVE', childCaps)
  expect(child).toBeTruthy()
  await repo.withFencedExecutionTransaction<Prisma.TransactionClient & QueueSqlExecutor>(
    fence(child!),
    async (scope) => {
      const run = await scope.transaction.archiveUploaderScanRun.findUniqueOrThrow({
        where: { systemJobId: child!.id }
      })
      await scope.transaction.archiveUploaderScanRun.update({
        where: { id: run.id },
        data: { status: failure ? 'FAILED' : 'COMPLETED', finishedAt: clock.now() }
      })
      await scope.transaction.archiveUploaderSource.update({
        where: { id: run.sourceId },
        data: { historyCursor, incrementalCursor }
      })
      if (failure) await scope.fail({ errorCode: 'REMOTE_UNAVAILABLE', error: 'provider failed' })
      else await scope.complete({ result: { uidDiscovery: { outcome: 'NOT_DISCOVERED' } } })
    }
  )
  return child!
}

suite('discovery batch PostgreSQL lifecycle', () => {
  beforeEach(async () => {
    await cleanup()
    clock.set(new Date())
  })
  afterAll(async () => {
    await cleanup()
    await db?.$disconnect()
  })

  it('serializes concurrent starts and replays the exact request without creating another batch', async () => {
    const s = await source()
    const request = { sourceIds: [s.id], requestId: randomUUID() }
    const same = await Promise.all([
      startDiscoveryBatch(request, prefix, db!),
      startDiscoveryBatch(request, prefix, db!)
    ])
    expect(same[0]).toEqual(same[1])
    await expect(batch([s.id])).rejects.toThrow('已有未结束')
    await expect(startDiscoveryBatch({ ...request, sourceIds: ['other'] }, prefix, db!)).rejects.toThrow('请求标识')
  })
  it('finishes incremental and historical rounds before advancing, surviving fresh coordinator instances', async () => {
    const a = await source()
    const b = await source('b')
    const { batchId } = await batch([a.id, b.id])
    await runParent()
    await finishChild('history', 'increment')
    await runParent()
    expect((await getDiscoveryBatch(batchId, db!))?.phase).toBe('LATEST')
    await finishChild('history')
    await runParent()
    expect((await getDiscoveryBatch(batchId, db!))?.phase).toBe('HISTORY')
    await finishChild(null)
    await runParent()
    expect((await getDiscoveryBatch(batchId, db!))?.processed).toBe(1)
    await runParent()
    await finishChild(null)
    await runParent()
    expect(await getDiscoveryBatch(batchId, db!)).toMatchObject({ active: false, status: 'COMPLETED', processed: 2 })
    expect(await db!.archiveIntakeItem.count()).toBe(0)
    expect(await db!.archiveImport.count()).toBe(0)
  })
  it('rolls back child creation and checkpoint together, then recovers the expired parent lease', async () => {
    const s = await source()
    const { batchId } = await batch([s.id])
    await expect(runParent(true)).rejects.toThrow('injected rollback')
    expect(await db!.systemJob.count({ where: { parentJobId: batchId } })).toBe(0)
    expect(await db!.archiveUploaderScanRun.count({ where: { sourceId: s.id } })).toBe(0)
    clock.advance(61_000)
    await runParent()
    expect(await db!.systemJob.count({ where: { parentJobId: batchId } })).toBe(1)
  })
  it('routes child pause to the batch and blocks retry claims until resume', async () => {
    const s = await source()
    const { batchId } = await batch([s.id])
    await runParent()
    const job = await db!.systemJob.findUniqueOrThrow({ where: { id: batchId } })
    const childId = parseDiscoveryBatchCheckpoint(job.result).childJobId!
    await pauseJobCommand({ jobId: childId }, db!)
    expect(await getDiscoveryBatch(batchId, db!)).toMatchObject({ status: 'PAUSED', active: true })
    expect(await repository().claim(`${prefix}-worker`, 'ARCHIVE_RESOLVE', childCaps)).toBeNull()
    await expect(batch([s.id])).rejects.toThrow('已有未结束')
    await commandDiscoveryBatch({ batchId, command: 'RESUME' }, db!)
    await finishChild(null)
    await runParent()
    expect((await getDiscoveryBatch(batchId, db!))?.status).toBe('COMPLETED')
  })
  it('lets a running round finish and prevents its retry while the parent is paused', async () => {
    const s = await source()
    const { batchId } = await batch([s.id])
    await runParent()
    const repo = repository()
    const child = (await repo.claim(`${prefix}-worker`, 'ARCHIVE_RESOLVE', childCaps))!
    await commandDiscoveryBatch({ batchId, command: 'PAUSE' }, db!)
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: child.id } })).status).toBe('RUNNING')
    expect((await getDiscoveryBatch(batchId, db!))?.status).toBe('PAUSING')
    await repo.withFencedExecutionTransaction(fence(child), async (scope) => {
      await scope.retry({ availableAt: clock.now(), errorCode: 'REMOTE_UNAVAILABLE', error: 'retry later' })
    })
    expect(await repo.claim(`${prefix}-worker`, 'ARCHIVE_RESOLVE', childCaps)).toBeNull()
    expect((await getDiscoveryBatch(batchId, db!))?.status).toBe('PAUSED')
    await commandDiscoveryBatch({ batchId, command: 'RESUME' }, db!)
    expect(await repo.claim(`${prefix}-worker`, 'ARCHIVE_RESOLVE', childCaps)).toMatchObject({ id: child.id })
  })
  it('cancels parent and queued child together from the task-center child action', async () => {
    const s = await source()
    const { batchId } = await batch([s.id])
    await runParent()
    const child = await db!.systemJob.findFirstOrThrow({ where: { parentJobId: batchId } })
    await cancelJobCommand({ jobId: child.id }, db!)
    await runParent()
    expect(await getDiscoveryBatch(batchId, db!)).toMatchObject({ status: 'CANCELLED', active: false })
    expect((await db!.archiveUploaderScanRun.findUniqueOrThrow({ where: { systemJobId: child.id } })).status).toBe(
      'CANCELLED'
    )
  })
  it('continues after final source failure and retries only failed sources', async () => {
    const a = await source()
    const b = await source('b')
    const { batchId } = await batch([a.id, b.id])
    await runParent()
    await finishChild(null, null, true)
    await runParent()
    await runParent()
    await finishChild(null)
    await runParent()
    const retried = await retryDiscoveryBatch({ batchId, requestId: randomUUID() }, prefix, db!)
    expect((await getDiscoveryBatch(retried.batchId, db!))?.sources.map(({ id }) => id)).toEqual([a.id])
  })

  it('cleans a failed coordinator orphan before retrying its unfinished source', async () => {
    const s = await source()
    const { batchId } = await batch([s.id])
    await runParent()
    const child = await db!.systemJob.findFirstOrThrow({ where: { parentJobId: batchId } })
    await db!.systemJob.update({ where: { id: batchId }, data: { status: 'FAILED', finishedAt: clock.now() } })
    const next = await retryDiscoveryBatch({ batchId, requestId: randomUUID() }, prefix, db!)
    expect((await db!.systemJob.findUniqueOrThrow({ where: { id: child.id } })).status).toBe('CANCELLED')
    expect((await db!.archiveUploaderScanRun.findUniqueOrThrow({ where: { systemJobId: child.id } })).status).toBe(
      'CANCELLED'
    )
    await runParent()
    expect(await db!.systemJob.count({ where: { parentJobId: next.batchId } })).toBe(1)
  })

  it('can resume a parent paused at its final permitted attempt', async () => {
    const s = await source()
    const { batchId } = await batch([s.id])
    await commandDiscoveryBatch({ batchId, command: 'PAUSE' }, db!)
    await db!.systemJob.update({ where: { id: batchId }, data: { attempt: 3, maxAttempts: 3 } })
    await commandDiscoveryBatch({ batchId, command: 'RESUME' }, db!)
    await runParent()
    expect(await db!.systemJob.count({ where: { parentJobId: batchId } })).toBe(1)
  })
})
