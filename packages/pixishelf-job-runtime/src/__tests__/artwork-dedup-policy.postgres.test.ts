import { randomUUID } from 'node:crypto'
import { PrismaClient } from '../../../pixishelf-db/src/index.js'
import { afterAll, describe, expect, it } from 'vitest'
import { PostgresQueueRepository, type QueueDatabase } from '../queue-repository.ts'
import { MutableQueueClock } from '../queue-clock.ts'
const url = process.env.QUEUE_KERNEL_TEST_DATABASE_URL
const db = url ? new PrismaClient({ datasourceUrl: url }) : null
const jobId = `dedup-policy-${randomUUID()}`
describe('detection queue entry policy', () => {
  it('rejects child creation before accessing a queue or accepting custom priorities', async () => {
    const repository = new PostgresQueueRepository({} as QueueDatabase)
    await expect(
      repository.enqueueChild(
        { jobId: 'parent', workerId: 'w', executionToken: randomUUID(), attempt: 1 },
        { type: 'ARTWORK_DEDUP_SCAN', queuePriority: 100, payload: { runId: 'r', executionVersion: 1 } }
      )
    ).rejects.toThrow(/domain service/)
  })
})
describe.skipIf(!db)('detection queue priority and recovery', () => {
  afterAll(async () => {
    if (db) {
      await db.jobResourceLease.deleteMany({ where: { ownerJobId: jobId } })
      await db.systemJob.deleteMany({ where: { id: jobId } })
      await db.$disconnect()
    }
  })
  it('keeps aged SYSTEM work at priority900 and refuses generic cancellation', async () => {
    const now = new Date('2026-10-24T10:00:00Z')
    await db!.systemJob.create({
      data: {
        id: jobId,
        type: 'ARTWORK_DEDUP_SCAN',
        payload: { runId: 'fixture', executionVersion: 1 },
        queuePriority: 900,
        effectivePriority: 900,
        createdAt: new Date(now.getTime() - 86400000),
        availableAt: now
      }
    })
    const repository = new PostgresQueueRepository(db! as unknown as QueueDatabase, {
      clock: new MutableQueueClock(now)
    })
    await expect(repository.requestCancellation(jobId)).rejects.toThrow(/domain service/)
    const claimed = await repository.claim('dedup-policy-worker', [
      { jobType: 'ARTWORK_DEDUP_SCAN', executionLane: 'BACKGROUND_WRITER', definitionVersions: [1] }
    ])
    expect(claimed?.id).toBe(jobId)
    expect(claimed?.effectivePriority).toBe(900)
    await repository.complete({
      jobId,
      workerId: claimed!.workerId,
      executionToken: claimed!.executionToken,
      attempt: claimed!.attempt
    })
  })
})
