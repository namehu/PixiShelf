import { Prisma } from '@pixishelf/db'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { jobRecord } from './test-fixtures'

const { enqueueJobMock } = vi.hoisted(() => ({ enqueueJobMock: vi.fn() }))

vi.mock('../job-command-service', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../job-command-service')>()),
  enqueueJob: enqueueJobMock
}))

import {
  enqueueSingletonManualJob,
  enqueueSingletonManualJobWithResult,
  enqueueSingletonSystemJobWithResult
} from '../manual-job-singleton'

function harness(existing: ReturnType<typeof jobRecord> | null) {
  const order: string[] = []
  const queryRaw = vi.fn(async () => {
    order.push('lock')
    return [{ lock: '' }]
  })
  const findFirst = vi.fn(async () => {
    order.push('find-active')
    return existing
  })
  const transaction = {
    $queryRaw: queryRaw,
    systemJob: { findFirst }
  } as unknown as Prisma.TransactionClient
  const client = {
    async $transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      order.push('transaction-begin')
      try {
        const result = await operation(transaction)
        order.push('transaction-commit')
        return result
      } catch (error) {
        order.push('transaction-rollback')
        throw error
      }
    }
  }
  return { client, queryRaw, findFirst, order, transaction }
}

describe('manual background job singleton', () => {
  beforeEach(() => {
    enqueueJobMock.mockReset().mockResolvedValue(jobRecord())
  })

  it('reuses an exactly equivalent paused request under the type advisory lock', async () => {
    const existing = jobRecord({
      id: 'probe-1',
      type: 'VIDEO_MEDIA_PROBE',
      status: 'PAUSED',
      payload: { enqueueMissingPosters: true, force: false },
      queuePriority: 30,
      effectivePriority: 30
    })
    const state = harness(existing)
    const afterEnqueue = vi.fn(async ({ transaction, reused }: { transaction: unknown; reused: boolean }) => {
      expect(transaction).toBe(state.transaction)
      expect(reused).toBe(true)
      state.order.push('scheduled-task-update')
    })

    const result = await enqueueSingletonManualJob(
      {
        type: 'VIDEO_MEDIA_PROBE',
        triggerSource: 'MANUAL',
        requestedByUserId: 'admin-2',
        priority: 30,
        payload: { force: false }
      },
      { client: state.client, afterEnqueue }
    )

    expect(result.id).toBe('probe-1')
    expect(state.queryRaw).toHaveBeenCalledOnce()
    expect(state.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: 'VIDEO_MEDIA_PROBE',
          status: { in: expect.arrayContaining(['PAUSED', 'RETRY_WAIT']) }
        })
      })
    )
    expect(enqueueJobMock).not.toHaveBeenCalled()
    expect(afterEnqueue).toHaveBeenCalledOnce()
    expect(state.order).toEqual([
      'transaction-begin',
      'lock',
      'find-active',
      'scheduled-task-update',
      'transaction-commit'
    ])
  })

  it('rejects a targeted reprobe while a normal probe is active instead of swallowing it', async () => {
    const state = harness(
      jobRecord({
        id: 'probe-normal',
        type: 'VIDEO_MEDIA_PROBE',
        payload: { enqueueMissingPosters: true, force: false },
        queuePriority: 30,
        effectivePriority: 30
      })
    )

    const failure = enqueueSingletonManualJob(
      {
        type: 'VIDEO_MEDIA_PROBE',
        triggerSource: 'MANUAL',
        requestedByUserId: 'admin-1',
        priority: 30,
        payload: { force: true, imageId: 42 }
      },
      { client: state.client }
    )

    await expect(failure).rejects.toMatchObject({
      code: 'ACTIVE_JOB_CONFLICT',
      message: expect.stringContaining('probe-normal')
    })
    expect(enqueueJobMock).not.toHaveBeenCalled()
  })

  it('rejects an active request bound to a different idempotency key', async () => {
    const state = harness(
      jobRecord({
        id: 'cleanup-with-key',
        type: 'TRIGGER_LOG_RETENTION_CLEANUP',
        idempotencyKey: 'cleanup-request-1',
        queuePriority: 20,
        effectivePriority: 20
      })
    )

    await expect(
      enqueueSingletonManualJob(
        {
          type: 'TRIGGER_LOG_RETENTION_CLEANUP',
          triggerSource: 'MANUAL',
          requestedByUserId: 'admin-1',
          priority: 20,
          payload: {},
          idempotencyKey: 'cleanup-request-2'
        },
        { client: state.client }
      )
    ).rejects.toMatchObject({
      code: 'ACTIVE_JOB_CONFLICT',
      message: expect.stringContaining('cleanup-with-key')
    })
    expect(enqueueJobMock).not.toHaveBeenCalled()
  })

  it('creates through the shared command service when no active instance exists', async () => {
    const state = harness(null)
    enqueueJobMock.mockImplementationOnce(async () => {
      state.order.push('enqueue-job')
      return jobRecord({ id: 'created-1', type: 'WEBP_ANIMATION_SCAN' })
    })
    const afterEnqueue = vi.fn(async ({ transaction, reused }: { transaction: unknown; reused: boolean }) => {
      expect(transaction).toBe(state.transaction)
      expect(reused).toBe(false)
      state.order.push('scheduled-task-update')
    })

    const result = await enqueueSingletonManualJob(
      {
        type: 'WEBP_ANIMATION_SCAN',
        triggerSource: 'MANUAL',
        requestedByUserId: 'admin-1',
        priority: 30,
        payload: {}
      },
      { client: state.client, afterEnqueue }
    )

    expect(result.id).toBe('created-1')
    expect(enqueueJobMock).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'WEBP_ANIMATION_SCAN', payload: {} }),
      expect.objectContaining({ $transaction: expect.any(Function) })
    )
    expect(state.order).toEqual([
      'transaction-begin',
      'lock',
      'find-active',
      'enqueue-job',
      'scheduled-task-update',
      'transaction-commit'
    ])
  })

  it('creates an internal singleton as SYSTEM without a requested user', async () => {
    const state = harness(null)
    enqueueJobMock.mockResolvedValueOnce(
      jobRecord({ id: 'system-scan', type: 'SCAN', triggerSource: 'SYSTEM', requestedByUserId: null })
    )

    await expect(
      enqueueSingletonSystemJobWithResult(
        {
          type: 'SCAN',
          triggerSource: 'SYSTEM',
          priority: 110,
          payload: { mode: 'INCREMENTAL' }
        },
        { client: state.client }
      )
    ).resolves.toMatchObject({ job: { id: 'system-scan' }, reused: false })
    expect(enqueueJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SCAN',
        triggerSource: 'SYSTEM',
        priority: 110,
        payload: { mode: 'INCREMENTAL' }
      }),
      expect.anything()
    )
    expect(enqueueJobMock.mock.calls[0]?.[0]).not.toHaveProperty('requestedByUserId')
  })

  it('reports created versus reused without changing the legacy return API', async () => {
    const existing = jobRecord({
      id: 'probe-existing',
      type: 'VIDEO_MEDIA_PROBE',
      payload: { force: true, enqueueMissingPosters: true, imageId: 9 },
      queuePriority: 20,
      effectivePriority: 20
    })
    const reusedState = harness(existing)
    const request = {
      type: 'VIDEO_MEDIA_PROBE' as const,
      triggerSource: 'MANUAL' as const,
      requestedByUserId: 'admin-1',
      priority: 20,
      payload: { force: true, enqueueMissingPosters: true, imageId: 9 }
    }

    await expect(enqueueSingletonManualJobWithResult(request, { client: reusedState.client })).resolves.toMatchObject({
      job: { id: 'probe-existing' },
      reused: true
    })

    const createdState = harness(null)
    enqueueJobMock.mockResolvedValueOnce(jobRecord({ id: 'probe-created', type: 'VIDEO_MEDIA_PROBE' }))
    await expect(enqueueSingletonManualJobWithResult(request, { client: createdState.client })).resolves.toMatchObject({
      job: { id: 'probe-created' },
      reused: false
    })
  })

  it('rolls back the singleton transaction when the after-enqueue write fails', async () => {
    const state = harness(null)
    enqueueJobMock.mockImplementationOnce(async () => {
      state.order.push('enqueue-job')
      return jobRecord({ id: 'created-before-metadata-failure' })
    })

    await expect(
      enqueueSingletonManualJob(
        {
          type: 'SCAN',
          triggerSource: 'MANUAL',
          requestedByUserId: 'admin-1',
          priority: 10,
          payload: { mode: 'INCREMENTAL' }
        },
        {
          client: state.client,
          afterEnqueue: async () => {
            state.order.push('scheduled-task-update-failed')
            throw new Error('scheduled task metadata update failed')
          }
        }
      )
    ).rejects.toThrow('scheduled task metadata update failed')
    expect(state.order).toEqual([
      'transaction-begin',
      'lock',
      'find-active',
      'enqueue-job',
      'scheduled-task-update-failed',
      'transaction-rollback'
    ])
  })

  it('serializes concurrent equal requests and creates only one active job', async () => {
    let active: ReturnType<typeof jobRecord> | null = null
    let lockTail = Promise.resolve()
    const client = {
      async $transaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
        let releaseLock: (() => void) | undefined
        const previousLock = lockTail
        lockTail = new Promise<void>((resolve) => {
          releaseLock = () => resolve()
        })
        const transaction = {
          $queryRaw: async () => previousLock,
          systemJob: { findFirst: async () => active }
        } as unknown as Prisma.TransactionClient
        try {
          return await operation(transaction)
        } finally {
          releaseLock?.()
        }
      }
    }
    enqueueJobMock.mockImplementationOnce(async () => {
      active = jobRecord({ id: 'singleton-1', type: 'SCAN_RUN_RETENTION_CLEANUP', queuePriority: 20 })
      return active
    })
    const request = {
      type: 'SCAN_RUN_RETENTION_CLEANUP' as const,
      triggerSource: 'MANUAL' as const,
      requestedByUserId: 'admin-1',
      priority: 20,
      payload: {}
    }

    const [first, second] = await Promise.all([
      enqueueSingletonManualJob(request, { client }),
      enqueueSingletonManualJob(request, { client })
    ])

    expect(first.id).toBe('singleton-1')
    expect(second.id).toBe('singleton-1')
    expect(enqueueJobMock).toHaveBeenCalledTimes(1)
  })
})
