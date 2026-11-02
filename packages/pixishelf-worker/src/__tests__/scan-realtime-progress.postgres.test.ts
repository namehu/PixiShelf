import { randomUUID } from 'node:crypto'
import { PrismaClient } from '@pixishelf/db'
import { MutableQueueClock, PostgresQueueRepository, type QueueDatabase } from '@pixishelf/job-runtime'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { CentralDispatcher } from '../dispatcher.ts'
import { ExecutorRegistry } from '../executor-registry.ts'
import { RuntimeDispatcherQueue } from '../runtime-dispatcher-queue.ts'

const url =
  process.env.QUEUE_KERNEL_TEST_DATABASE_URL ?? (process.env.CI === 'true' ? process.env.DATABASE_URL : undefined)
const suite = url ? describe.sequential : describe.skip
const database = url ? new PrismaClient({ datasourceUrl: url }) : null
const prefix = `scan-realtime-${randomUUID()}`

suite('ordinary SCAN realtime persistence through Dispatcher and PostgreSQL', () => {
  afterAll(async () => {
    if (!database) return
    await database.jobResourceLease.deleteMany({ where: { ownerJobId: { startsWith: prefix } } })
    await database.systemJob.deleteMany({ where: { id: { startsWith: prefix } } })
    await database.$disconnect()
  })

  it('persists the two-second durable count and forced final count with their matching events', async () => {
    const db = database!
    const clock = new MutableQueueClock(new Date('2026-11-01T18:00:00.000Z'))
    const job = await db.systemJob.create({
      data: {
        id: `${prefix}-job`,
        type: 'SCAN',
        definitionVersion: 1,
        status: 'PENDING',
        triggerSource: 'MANUAL',
        queuePriority: 0,
        effectivePriority: 0,
        availableAt: clock.now(),
        payload: { mode: 'INCREMENTAL' }
      }
    })
    const repository = new PostgresQueueRepository(db as unknown as QueueDatabase, { clock })
    const registry = new ExecutorRegistry().register({
      jobType: 'SCAN',
      definitionVersion: 1,
      execute: async ({ progress }) => {
        const sample = (processed: number, forcePersistence = false) =>
          progress({
            progress: processed,
            stage: 'PROCESSING',
            data: { processed, total: 52 },
            persistenceMode: 'REALTIME',
            ...(forcePersistence ? { forcePersistence: true } : {})
          })
        await sample(0)
        clock.advance(1_000)
        await sample(1)
        expect(await db.systemJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ progress: 0 })
        clock.advance(1_000)
        await sample(2)
        expect(await db.systemJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ progress: 2 })
        clock.advance(100)
        await sample(3)
        await sample(3, true)
        expect(await db.systemJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ progress: 3 })
        return { kind: 'completed' }
      }
    })
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
    const dispatcher = new CentralDispatcher({
      enabled: true,
      workerId: prefix,
      queue: new RuntimeDispatcherQueue(repository),
      registry,
      logger,
      pollIntervalMs: 100,
      heartbeatIntervalMs: 1_000,
      drainGraceMs: 1_000,
      timing: {
        now: () => clock.now(),
        sleep: (_milliseconds, signal) =>
          new Promise<void>((_resolve, reject) => {
            if (signal.aborted) reject(signal.reason)
            else signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
      }
    })
    try {
      await dispatcher.prepare()
      dispatcher.activate()
      await vi.waitFor(async () =>
        expect(await db.systemJob.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'COMPLETED' })
      )
      const events = await db.systemJobEvent.findMany({
        where: { jobId: job.id, type: { in: ['job.stage_changed', 'job.progress'] } },
        orderBy: { id: 'asc' }
      })
      expect(events.map((event) => event.progress)).toEqual([0, 2, 3])
      expect(events.map((event) => (event.data as { data: { processed: number } }).data.processed)).toEqual([0, 2, 3])
      expect(events[1]!.createdAt.getTime() - events[0]!.createdAt.getTime()).toBe(2_000)
      expect(events[2]!.createdAt.getTime() - events[1]!.createdAt.getTime()).toBe(100)
      expect(logger.error).not.toHaveBeenCalled()
    } finally {
      await dispatcher.stop()
    }
  })
})
