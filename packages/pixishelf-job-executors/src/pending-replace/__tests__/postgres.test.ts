import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase, type PrismaClient } from '@pixishelf/db'
import {
  JobExecutionFenceError,
  MutableQueueClock,
  PostgresQueueRepository,
  type ClaimedJob,
  type QueueDatabase
} from '@pixishelf/job-runtime'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'

const databaseUrl =
  process.env.PIXISHELF_TEST_DATABASE_URL ??
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ??
  (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const describePostgres = databaseUrl ? describe : describe.skip
const prefix = `pending-replace-pg-${randomUUID()}`
const prisma = databaseUrl ? createDatabaseClient({ datasourceUrl: databaseUrl }) : null
const clock = new MutableQueueClock(new Date('2026-08-15T00:30:00.000Z'))
const capabilities = [
  { jobType: 'PENDING_REPLACE' as const, executionLane: 'BACKGROUND_WRITER' as const, definitionVersions: [1] }
]

describePostgres('pending replacement PostgreSQL fences', () => {
  beforeEach(async () => {
    await db().systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
    await db().pendingReplaceBatch.deleteMany({ where: { id: { startsWith: prefix } } })
  })

  afterAll(async () => {
    if (!prisma) return
    await prisma.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
    await prisma.pendingReplaceBatch.deleteMany({ where: { id: { startsWith: prefix } } })
    await disconnectDatabase(prisma)
  })

  it('enforces operation mode/item ownership constraints in real PostgreSQL', async () => {
    const first = await seedDomain('constraint-a')
    const second = await seedDomain('constraint-b')
    const batchModeJob = await seedJob('constraint-batch-mode')
    await expect(
      db().pendingReplaceOperation.create({
        data: { systemJobId: batchModeJob, batchId: first.batchId, itemId: first.itemId, mode: 'BATCH' }
      })
    ).rejects.toBeTruthy()

    const crossBatchJob = await seedJob('constraint-cross-batch')
    await expect(
      db().pendingReplaceOperation.create({
        data: { systemJobId: crossBatchJob, batchId: first.batchId, itemId: second.itemId, mode: 'RESTORE' }
      })
    ).rejects.toBeTruthy()
    await expect(
      db().pendingReplaceOperation.count({ where: { systemJobId: { in: [batchModeJob, crossBatchJob] } } })
    ).resolves.toBe(0)
  })

  it('rolls domain checkpoint and queue completion back together, then commits together', async () => {
    const domain = await seedDomain('atomic')
    const jobId = await seedJob('atomic')
    await db().pendingReplaceOperation.create({
      data: { systemJobId: jobId, batchId: domain.batchId, itemId: null, mode: 'BATCH' }
    })
    const repository = queue()
    const claimed = (await repository.claim(`${prefix}-atomic-worker`, capabilities))!

    await expect(
      repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
        await scope.transaction.$executeRawUnsafe(
          `UPDATE "pending_replace_items" SET status = 'SUCCESS'::"PendingReplaceItemStatus" WHERE id = $1`,
          domain.itemId
        )
        await scope.complete({ result: { atomic: true } })
        throw new Error('force transaction rollback')
      })
    ).rejects.toThrow('force transaction rollback')
    await expect(
      db().pendingReplaceItem.findUniqueOrThrow({ where: { id: domain.itemId }, select: { status: true } })
    ).resolves.toEqual({ status: 'READY' })
    await expect(db().systemJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true } })).resolves.toEqual(
      { status: 'RUNNING' }
    )

    await repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
      await scope.transaction.$executeRawUnsafe(
        `UPDATE "pending_replace_items" SET status = 'SUCCESS'::"PendingReplaceItemStatus" WHERE id = $1`,
        domain.itemId
      )
      await scope.complete({ result: { atomic: true } })
    })
    await expect(
      db().pendingReplaceItem.findUniqueOrThrow({ where: { id: domain.itemId }, select: { status: true } })
    ).resolves.toEqual({ status: 'SUCCESS' })
    await expect(
      db().systemJob.findUniqueOrThrow({ where: { id: jobId }, select: { status: true, result: true } })
    ).resolves.toEqual({
      status: 'COMPLETED',
      result: { atomic: true }
    })
  })

  it('lets locked cancellation atomically win and rejects a stale fence before domain code', async () => {
    const cancelledDomain = await seedDomain('cancel')
    const cancelledJob = await seedJob('cancel')
    await db().pendingReplaceOperation.create({
      data: { systemJobId: cancelledJob, batchId: cancelledDomain.batchId, itemId: null, mode: 'BATCH' }
    })
    const repository = queue()
    const claimed = (await repository.claim(`${prefix}-cancel-worker`, capabilities))!
    await db().systemJob.update({
      where: { id: cancelledJob },
      data: { status: 'CANCELLING', cancelRequestedAt: clock.now() }
    })
    await repository.withFencedExecutionTransaction(fence(claimed), async (scope) => {
      expect(scope.executionStatus).toBe('CANCELLING')
      await scope.transaction.$executeRawUnsafe(
        `UPDATE "pending_replace_items" SET status = 'FAILED'::"PendingReplaceItemStatus" WHERE id = $1`,
        cancelledDomain.itemId
      )
      await scope.cancel('cancelled at durable checkpoint')
    })
    await expect(
      db().systemJob.findUniqueOrThrow({ where: { id: cancelledJob }, select: { status: true } })
    ).resolves.toEqual({ status: 'CANCELLED' })
    await expect(
      db().pendingReplaceItem.findUniqueOrThrow({ where: { id: cancelledDomain.itemId }, select: { status: true } })
    ).resolves.toEqual({ status: 'FAILED' })

    const staleDomain = await seedDomain('stale')
    const staleJob = await seedJob('stale')
    await db().pendingReplaceOperation.create({
      data: { systemJobId: staleJob, batchId: staleDomain.batchId, itemId: null, mode: 'BATCH' }
    })
    const staleClaim = (await repository.claim(`${prefix}-stale-worker`, capabilities))!
    await db().jobResourceLease.deleteMany({ where: { ownerJobId: staleJob } })
    let entered = false
    await expect(
      repository.withFencedExecutionTransaction(fence(staleClaim), async () => {
        entered = true
      })
    ).rejects.toBeInstanceOf(JobExecutionFenceError)
    expect(entered).toBe(false)
    await expect(
      db().pendingReplaceItem.findUniqueOrThrow({ where: { id: staleDomain.itemId }, select: { status: true } })
    ).resolves.toEqual({ status: 'READY' })
  })
})

function db(): PrismaClient {
  if (!prisma) throw new Error('PostgreSQL test URL is required')
  return prisma
}

function queue() {
  return new PostgresQueueRepository(db() as unknown as QueueDatabase, {
    clock,
    leaseDurationMs: 60_000,
    transactionMaxWaitMs: 5_000,
    transactionTimeoutMs: 10_000
  })
}

function fence(job: ClaimedJob) {
  return { jobId: job.id, workerId: job.workerId, executionToken: job.executionToken, attempt: job.attempt }
}

async function seedJob(label: string) {
  const id = `${prefix}-job-${label}-${randomUUID()}`
  await db().systemJob.create({
    data: {
      id,
      type: 'PENDING_REPLACE',
      definitionVersion: 1,
      status: 'PENDING',
      triggerSource: 'MANUAL',
      payload: { mode: 'BATCH', batchId: `${prefix}-placeholder`, itemIds: ['placeholder'], appendTagIds: [] },
      queuePriority: 5,
      effectivePriority: 5,
      availableAt: clock.now(),
      maxAttempts: 3
    }
  })
  return id
}

async function seedDomain(label: string) {
  const batchId = `${prefix}-batch-${label}-${randomUUID()}`
  const itemId = `${prefix}-item-${label}-${randomUUID()}`
  await db().pendingReplaceBatch.create({ data: { id: batchId, sourceRoot: '/pending-replaces' } })
  await db().pendingReplaceItem.create({
    data: {
      id: itemId,
      batchId,
      sourceDirectory: `/pending-replaces/${label}`,
      sourceDirectoryName: label,
      status: 'READY',
      sourceManifest: [],
      oldMediaSnapshot: [],
      newMediaSnapshot: [],
      targetFileSnapshot: [],
      warnings: []
    }
  })
  return { batchId, itemId }
}
