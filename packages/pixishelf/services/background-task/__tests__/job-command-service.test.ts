import { Prisma } from '@pixishelf/db'
import { describe, expect, it, vi } from 'vitest'
import { BackgroundTaskError } from '../background-task-error'
import {
  cancelJobCommand,
  changeJobPriorityCommand,
  enqueueJob,
  manualEnqueueJobRequestSchema,
  pauseJobCommand,
  resumeJobCommand,
  retryJobCommand
} from '../job-command-service'
import { eventRecord, jobRecord } from './test-fixtures'

function commandHarness(records: ReturnType<typeof jobRecord>[]) {
  const queryRaw = vi.fn().mockResolvedValue([{ pg_advisory_xact_lock: null }])
  const findUnique = vi.fn()
  for (const record of records) findUnique.mockResolvedValueOnce(record)
  const updateMany = vi.fn().mockResolvedValue({ count: 1 })
  const create = vi.fn().mockResolvedValue(records.at(-1))
  let eventId = BigInt(0)
  const eventCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
    eventRecord({
      id: (eventId += BigInt(1)),
      jobId: String(data.jobId),
      type: data.type as ReturnType<typeof eventRecord>['type'],
      attempt: Number(data.attempt),
      message: data.message as string | null,
      data: (data.data as object | null) ?? null
    })
  )
  const transaction = {
    $queryRaw: queryRaw,
    systemJob: { findUnique, updateMany, create },
    systemJobEvent: { create: eventCreate }
  } as unknown as Prisma.TransactionClient
  const client = { $transaction: <T>(callback: (tx: Prisma.TransactionClient) => Promise<T>) => callback(transaction) }
  return { client, queryRaw, findUnique, updateMany, create, eventCreate }
}

describe('enqueueJob', () => {
  it('creates a PENDING manual job and its queued event in one transaction', async () => {
    const created = jobRecord()
    const harness = commandHarness([null as never, created])
    harness.findUnique.mockReset().mockResolvedValueOnce(null)
    harness.create.mockResolvedValue(created)

    const result = await enqueueJob(
      {
        type: 'SCAN',
        triggerSource: 'MANUAL',
        requestedByUserId: 'user-1',
        priority: 10,
        payload: { mode: 'INCREMENTAL' }
      },
      harness.client,
      () => new Date('2026-08-14T10:00:00.000Z')
    )

    expect(result.status).toBe('PENDING')
    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'PENDING', queuePriority: 10, effectivePriority: 10 })
      })
    )
    expect(harness.eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ jobId: 'job-1', type: 'job.queued' }) })
    )
  })

  it('projects canonical keyframe generation payload fields into legacy columns', async () => {
    const created = jobRecord({ type: 'VIDEO_KEYFRAME_GENERATION' })
    const harness = commandHarness([created])
    harness.create.mockResolvedValue(created)

    await enqueueJob(
      {
        type: 'VIDEO_KEYFRAME_GENERATION',
        triggerSource: 'MANUAL',
        requestedByUserId: 'user-1',
        priority: 10,
        payload: {
          imageId: 42,
          relativePath: 'videos/example.mp4',
          mode: 'MANUAL_FORCE'
        }
      },
      harness.client
    )

    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetImageId: 42,
          targetPath: 'videos/example.mp4',
          mode: 'MANUAL_FORCE'
        })
      })
    )
  })

  it('enforces separate manual and scheduled priority bands', async () => {
    const harness = commandHarness([])
    await expect(
      enqueueJob({ type: 'SCAN', triggerSource: 'MANUAL', requestedByUserId: 'user-1', priority: 100 }, harness.client)
    ).rejects.toThrow()
    await expect(
      enqueueJob(
        {
          type: 'SCAN',
          triggerSource: 'SCHEDULE',
          scheduledTaskId: 'schedule-1',
          scheduledForDate: '2026-08-14',
          deadlineAt: new Date('2026-08-15T00:00:00.000Z'),
          priority: 99
        },
        harness.client
      )
    ).rejects.toThrow()
    expect(harness.create).not.toHaveBeenCalled()
    expect(
      manualEnqueueJobRequestSchema.safeParse({ type: 'SCAN', triggerSource: 'SCHEDULE', priority: 100 }).success
    ).toBe(false)
  })

  it('returns an idempotent scheduled instance without creating a second queued event', async () => {
    const existing = jobRecord({
      type: 'SCAN_RUN_RETENTION_CLEANUP',
      triggerSource: 'SCHEDULE',
      requestedByUserId: null,
      scheduledTaskId: 'schedule-1',
      scheduledForDate: '2026-08-14',
      idempotencyKey: 'scheduled-task:schedule-1:2026-08-14:v1',
      queuePriority: 120,
      effectivePriority: 120,
      deadlineAt: new Date('2026-08-14T00:00:00.000Z')
    })
    const harness = commandHarness([existing])

    await expect(
      enqueueJob(
        {
          type: 'SCAN_RUN_RETENTION_CLEANUP',
          triggerSource: 'SCHEDULE',
          scheduledTaskId: 'schedule-1',
          scheduledForDate: '2026-08-14',
          idempotencyKey: 'scheduled-task:schedule-1:2026-08-14:v1',
          deadlineAt: new Date('2026-08-14T00:00:00.000Z'),
          priority: 120
        },
        harness.client
      )
    ).resolves.toMatchObject({ id: existing.id })
    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.eventCreate).not.toHaveBeenCalled()
    const advisoryQuery = harness.queryRaw.mock.calls[0]?.[0] as {
      strings: readonly string[]
      values: readonly unknown[]
    }
    expect(advisoryQuery.strings.join('')).not.toContain(existing.idempotencyKey!)
    expect(advisoryQuery.values).toContain(existing.idempotencyKey)
  })

  it('rejects reuse of an idempotency key with different payload semantics', async () => {
    const existing = jobRecord({
      type: 'VIDEO_MEDIA_PROBE',
      triggerSource: 'MANUAL',
      requestedByUserId: 'user-1',
      payload: { force: false, enqueueMissingPosters: true },
      idempotencyKey: 'manual-probe-1',
      queuePriority: 10,
      effectivePriority: 10
    })
    const harness = commandHarness([existing])

    const error = await enqueueJob(
      {
        type: 'VIDEO_MEDIA_PROBE',
        triggerSource: 'MANUAL',
        requestedByUserId: 'user-1',
        payload: { force: true, enqueueMissingPosters: true },
        idempotencyKey: 'manual-probe-1',
        priority: 10
      },
      harness.client
    ).catch((caught: unknown) => caught)

    expect(error).toBeInstanceOf(BackgroundTaskError)
    expect(error).toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' })
    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.eventCreate).not.toHaveBeenCalled()
  })

  it('serializes concurrent requests with the same idempotency key before find and create', async () => {
    const operations: string[] = []
    let existing: ReturnType<typeof jobRecord> | null = null
    let transactionTail = Promise.resolve()
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      operations.push('create')
      existing = jobRecord({
        type: String(data.type),
        definitionVersion: Number(data.definitionVersion),
        triggerSource: data.triggerSource as 'MANUAL',
        requestedByUserId: String(data.requestedByUserId),
        payload: data.payload as object,
        idempotencyKey: String(data.idempotencyKey),
        queuePriority: Number(data.queuePriority),
        effectivePriority: Number(data.effectivePriority),
        availableAt: data.availableAt as Date,
        maxAttempts: Number(data.maxAttempts)
      })
      return existing
    })
    const eventCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) =>
      eventRecord({ jobId: String(data.jobId), type: 'job.queued' })
    )
    const client = {
      async $transaction<T>(callback: (transaction: Prisma.TransactionClient) => Promise<T>) {
        let releaseLock: (() => void) | undefined
        const transaction = {
          $queryRaw: async () => {
            const previous = transactionTail
            transactionTail = new Promise<void>((resolve) => {
              releaseLock = resolve
            })
            await previous
            operations.push('lock')
            return [{ pg_advisory_xact_lock: null }]
          },
          systemJob: {
            findUnique: async () => {
              operations.push('find')
              return existing
            },
            create
          },
          systemJobEvent: { create: eventCreate }
        } as unknown as Prisma.TransactionClient
        try {
          return await callback(transaction)
        } finally {
          releaseLock?.()
        }
      }
    }
    const request = {
      type: 'SCAN' as const,
      triggerSource: 'MANUAL' as const,
      requestedByUserId: 'user-1',
      idempotencyKey: 'concurrent-manual-1',
      priority: 10,
      payload: { mode: 'INCREMENTAL' as const }
    }

    const results = await Promise.all([enqueueJob(request, client), enqueueJob(request, client)])

    expect(results[0]?.id).toBe(results[1]?.id)
    expect(create).toHaveBeenCalledOnce()
    expect(eventCreate).toHaveBeenCalledOnce()
    expect(operations).toEqual(['lock', 'find', 'create', 'lock', 'find'])
  })

  it('reloads and validates the winning record after a cross-writer P2002', async () => {
    const idempotencyKey = 'cross-writer-manual-1'
    const existing = jobRecord({
      type: 'SCAN',
      triggerSource: 'MANUAL',
      requestedByUserId: 'user-1',
      idempotencyKey,
      payload: { mode: 'INCREMENTAL' },
      queuePriority: 10,
      effectivePriority: 10
    })
    const queryRaw = vi.fn().mockResolvedValue([{ lock: '' }])
    const create = vi.fn().mockRejectedValue(Object.assign(new Error('unique conflict'), { code: 'P2002' }))
    const firstTransaction = {
      $queryRaw: queryRaw,
      systemJob: { findUnique: vi.fn().mockResolvedValue(null), create },
      systemJobEvent: { create: vi.fn() }
    } as unknown as Prisma.TransactionClient
    const secondTransaction = {
      $queryRaw: queryRaw,
      systemJob: { findUnique: vi.fn().mockResolvedValue(existing) }
    } as unknown as Prisma.TransactionClient
    const client = {
      $transaction: vi
        .fn()
        .mockImplementationOnce((callback) => callback(firstTransaction))
        .mockImplementationOnce((callback) => callback(secondTransaction))
    }

    await expect(
      enqueueJob(
        {
          type: 'SCAN',
          triggerSource: 'MANUAL',
          requestedByUserId: 'user-1',
          idempotencyKey,
          priority: 10,
          payload: { mode: 'INCREMENTAL' }
        },
        client
      )
    ).resolves.toMatchObject({ id: existing.id })
    expect(client.$transaction).toHaveBeenCalledTimes(2)
    expect(queryRaw).toHaveBeenCalledTimes(2)
  })
})

describe('job commands', () => {
  it('moves RUNNING cancellation to CANCELLING with an event', async () => {
    const current = jobRecord({ status: 'RUNNING', workerId: 'worker-1', attempt: 1 })
    const updated = jobRecord({ ...current, status: 'CANCELLING' })
    const harness = commandHarness([current, updated])
    const result = await cancelJobCommand({ jobId: current.id }, harness.client)
    expect(result.status).toBe('CANCELLING')
    expect(harness.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: current.id, status: 'RUNNING' },
        data: expect.objectContaining({ status: 'CANCELLING' })
      })
    )
    expect(harness.eventCreate).toHaveBeenCalledOnce()
  })

  it('pauses queued work directly and resumes it to PENDING', async () => {
    const pending = jobRecord({ status: 'PENDING' })
    const paused = jobRecord({ ...pending, status: 'PAUSED' })
    const pauseHarness = commandHarness([pending, paused])
    await expect(pauseJobCommand({ jobId: pending.id }, pauseHarness.client)).resolves.toMatchObject({
      status: 'PAUSED'
    })
    expect(pauseHarness.eventCreate).toHaveBeenCalledTimes(2)

    const resumed = jobRecord({ ...paused, status: 'PENDING' })
    const resumeHarness = commandHarness([paused, resumed])
    await expect(resumeJobCommand({ jobId: paused.id }, resumeHarness.client)).resolves.toMatchObject({
      status: 'PENDING'
    })
    expect(resumeHarness.eventCreate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ type: 'job.queued' }) })
    )
  })

  it('retries a terminal failure as a new linked instance without mutating history', async () => {
    const failed = jobRecord({
      status: 'FAILED',
      payload: { mode: 'INCREMENTAL' },
      attempt: 3,
      maxAttempts: 3,
      workerId: 'worker-old',
      error: 'token=secret failure',
      finishedAt: new Date()
    })
    const retried = jobRecord({
      id: 'job-retry-1',
      status: 'PENDING',
      triggerSource: 'RETRY',
      parentJobId: failed.id,
      queuePriority: 10,
      effectivePriority: 10
    })
    const harness = commandHarness([failed, retried])
    harness.create.mockResolvedValue(retried)
    await expect(
      retryJobCommand({ jobId: failed.id, requestedByUserId: 'admin-1' }, harness.client)
    ).resolves.toMatchObject({
      id: 'job-retry-1',
      status: 'PENDING',
      triggerSource: 'RETRY',
      parentJobId: failed.id
    })
    expect(harness.updateMany).not.toHaveBeenCalled()
    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          triggerSource: 'RETRY',
          requestedByUserId: 'admin-1',
          parentJobId: failed.id,
          queuePriority: 10
        })
      })
    )
    expect(harness.eventCreate).toHaveBeenCalledTimes(2)
  })

  it('projects canonical keyframe generation payload fields when creating a retry', async () => {
    const failed = jobRecord({
      type: 'VIDEO_KEYFRAME_GENERATION',
      status: 'FAILED',
      payload: {
        imageId: 84,
        relativePath: 'videos/retry.mp4',
        mode: 'MANUAL_INCREMENTAL'
      },
      finishedAt: new Date()
    })
    const retried = jobRecord({
      id: 'job-keyframe-retry-1',
      type: 'VIDEO_KEYFRAME_GENERATION',
      status: 'PENDING',
      triggerSource: 'RETRY',
      parentJobId: failed.id,
      payload: failed.payload
    })
    const harness = commandHarness([failed, retried])
    harness.create.mockResolvedValue(retried)

    await retryJobCommand({ jobId: failed.id, requestedByUserId: 'admin-1' }, harness.client)

    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targetImageId: 84,
          targetPath: 'videos/retry.mp4',
          mode: 'MANUAL_INCREMENTAL'
        })
      })
    )
  })

  it('canonicalizes a valid high-risk payload before creating a retry', async () => {
    const failed = jobRecord({
      type: 'MIGRATION',
      status: 'FAILED',
      payload: { selection: { mode: 'ARTWORK_IDS', artworkIds: [9, 3, 9] } },
      finishedAt: new Date()
    })
    const retried = jobRecord({ id: 'job-migration-retry-1', type: 'MIGRATION', status: 'PENDING' })
    const harness = commandHarness([failed, retried])
    harness.create.mockResolvedValue(retried)

    await retryJobCommand({ jobId: failed.id, requestedByUserId: 'admin-1' }, harness.client)

    expect(harness.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          payload: {
            selection: { mode: 'ARTWORK_IDS', artworkIds: [3, 9] },
            safety: { transferMode: 'move', verifyAfterCopy: true, cleanupSource: true }
          }
        })
      })
    )
  })

  it('rejects retrying a historical v1 job whose payload no longer matches the strict contract', async () => {
    const historical = jobRecord({ status: 'FAILED', payload: {}, finishedAt: new Date() })
    const harness = commandHarness([historical])

    const error = await retryJobCommand({ jobId: historical.id, requestedByUserId: 'admin-1' }, harness.client).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(BackgroundTaskError)
    expect(error).toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    expect(harness.create).not.toHaveBeenCalled()
    expect(harness.eventCreate).not.toHaveBeenCalled()
  })

  it('rejects retrying a future definition version that the current Worker cannot consume', async () => {
    const future = jobRecord({ definitionVersion: 2, status: 'FAILED', finishedAt: new Date() })
    const harness = commandHarness([future])

    const error = await retryJobCommand({ jobId: future.id, requestedByUserId: 'admin-1' }, harness.client).catch(
      (caught: unknown) => caught
    )

    expect(error).toBeInstanceOf(BackgroundTaskError)
    expect(error).toMatchObject({ code: 'INVALID_STATE_TRANSITION' })
    expect(harness.create).not.toHaveBeenCalled()
  })

  it('rejects invalid transitions without writing an event', async () => {
    const completed = jobRecord({ status: 'COMPLETED', finishedAt: new Date() })
    const harness = commandHarness([completed])
    await expect(pauseJobCommand({ jobId: completed.id }, harness.client)).rejects.toBeInstanceOf(BackgroundTaskError)
    expect(harness.updateMany).not.toHaveBeenCalled()
    expect(harness.eventCreate).not.toHaveBeenCalled()
  })

  it('changes priority only inside the source band', async () => {
    const pending = jobRecord({ triggerSource: 'MANUAL', queuePriority: 10, effectivePriority: 10 })
    const updated = jobRecord({ ...pending, queuePriority: 2, effectivePriority: 2 })
    const harness = commandHarness([pending, updated])
    await expect(changeJobPriorityCommand({ jobId: pending.id, priority: 2 }, harness.client)).resolves.toMatchObject({
      queuePriority: 2
    })

    const invalidHarness = commandHarness([pending])
    await expect(changeJobPriorityCommand({ jobId: pending.id, priority: 100 }, invalidHarness.client)).rejects.toThrow(
      'manual job priority'
    )
    expect(invalidHarness.updateMany).not.toHaveBeenCalled()

    const scheduled = jobRecord({ triggerSource: 'SCHEDULE', queuePriority: 100, effectivePriority: 100 })
    const scheduledHarness = commandHarness([scheduled])
    await expect(
      changeJobPriorityCommand({ jobId: scheduled.id, priority: 99 }, scheduledHarness.client)
    ).rejects.toThrow('schedule job priority')
    expect(scheduledHarness.updateMany).not.toHaveBeenCalled()

    const retry = jobRecord({ triggerSource: 'RETRY', queuePriority: 50, effectivePriority: 50 })
    const retryUpdated = jobRecord({ ...retry, queuePriority: 1, effectivePriority: 1 })
    const retryHarness = commandHarness([retry, retryUpdated])
    await expect(
      changeJobPriorityCommand({ jobId: retry.id, priority: 1 }, retryHarness.client)
    ).resolves.toMatchObject({
      queuePriority: 1
    })
  })
})
