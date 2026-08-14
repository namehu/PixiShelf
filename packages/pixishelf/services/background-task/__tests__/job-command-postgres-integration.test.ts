import { randomUUID } from 'node:crypto'
import { createDatabaseClient, disconnectDatabase } from '@pixishelf/db'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BackgroundTaskError } from '../background-task-error'
import { enqueueJob } from '../job-command-service'
import { runScheduleMaterializerTick } from '../schedule-materializer'

const testDatabaseUrl = Reflect.get(process.env, 'PIXISHELF_TEST_DATABASE_URL') as string | undefined
const describePostgres = testDatabaseUrl ? describe : describe.skip
const suitePrefix = `phase3-next-pg-${randomUUID()}`
const client = createDatabaseClient(testDatabaseUrl ? { datasourceUrl: testDatabaseUrl } : undefined)

describePostgres('background task PostgreSQL concurrency', () => {
  beforeAll(async () => {
    await client.$connect()
  })

  afterEach(async () => {
    const scheduledTasks = await client.scheduledTask.findMany({
      where: { key: { startsWith: suitePrefix } },
      select: { id: true }
    })
    const scheduledTaskIds = scheduledTasks.map(({ id }) => id)
    await client.systemJob.deleteMany({
      where: {
        OR: [
          { idempotencyKey: { startsWith: suitePrefix } },
          ...(scheduledTaskIds.length > 0 ? [{ scheduledTaskId: { in: scheduledTaskIds } }] : [])
        ]
      }
    })
    await client.scheduledTask.deleteMany({ where: { id: { in: scheduledTaskIds } } })
  })

  afterAll(async () => {
    await disconnectDatabase(client)
  })

  it('creates one job and one queued event for two concurrent requests with the same idempotency key', async () => {
    const idempotencyKey = `${suitePrefix}-same-request`
    const request = {
      type: 'VIDEO_MEDIA_PROBE' as const,
      triggerSource: 'MANUAL' as const,
      requestedByUserId: 'postgres-test-admin',
      idempotencyKey,
      payload: { force: false, enqueueMissingPosters: true },
      priority: 10
    }

    const [first, second] = await Promise.all([enqueueJob(request, client), enqueueJob(request, client)])

    expect(first.id).toBe(second.id)
    await expect(client.systemJob.count({ where: { idempotencyKey } })).resolves.toBe(1)
    await expect(client.systemJobEvent.count({ where: { jobId: first.id, type: 'job.queued' } })).resolves.toBe(1)
  })

  it('rejects the same idempotency key when its payload semantics differ', async () => {
    const idempotencyKey = `${suitePrefix}-payload-conflict`
    const common = {
      type: 'VIDEO_MEDIA_PROBE' as const,
      triggerSource: 'MANUAL' as const,
      requestedByUserId: 'postgres-test-admin',
      idempotencyKey,
      priority: 10
    }
    const created = await enqueueJob({ ...common, payload: { force: false, enqueueMissingPosters: true } }, client)

    const error = await enqueueJob({ ...common, payload: { force: true, enqueueMissingPosters: true } }, client).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(BackgroundTaskError)
    expect(error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    await expect(client.systemJob.count({ where: { idempotencyKey } })).resolves.toBe(1)
    await expect(client.systemJobEvent.count({ where: { jobId: created.id, type: 'job.queued' } })).resolves.toBe(1)
  })

  it('materializes one scheduled job and event for two concurrent ticks', async () => {
    const task = await client.scheduledTask.create({
      data: {
        key: `${suitePrefix}-scheduled`,
        type: 'SCAN_RUN_RETENTION_CLEANUP',
        enabled: true,
        scheduleMode: 'DAILY',
        time: '05:00',
        timezone: 'Asia/Shanghai',
        priority: 20
      }
    })
    const now = new Date('2026-08-14T17:00:00.000Z')
    const dependencies = {
      cutoverEnabled: true,
      database: client,
      ensureDefaults: async () => undefined
    }

    await Promise.all([runScheduleMaterializerTick(now, dependencies), runScheduleMaterializerTick(now, dependencies)])

    const jobs = await client.systemJob.findMany({
      where: { scheduledTaskId: task.id, scheduledForDate: '2026-08-15' },
      select: { id: true }
    })
    expect(jobs).toHaveLength(1)
    await expect(client.systemJobEvent.count({ where: { jobId: jobs[0]!.id, type: 'job.queued' } })).resolves.toBe(1)
  })
})
