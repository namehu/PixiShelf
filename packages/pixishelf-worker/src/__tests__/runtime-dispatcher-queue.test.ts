import { describe, expect, it, vi } from 'vitest'
import type { ExecutionFence } from '@pixishelf/job-runtime'
import { RuntimeDispatcherQueue, type QueueRepositoryPort } from '../runtime-dispatcher-queue.js'

describe('RuntimeDispatcherQueue', () => {
  it('maps every canonical dispatcher outcome to its fenced repository transition', async () => {
    const repository = createRepository()
    const queue = new RuntimeDispatcherQueue(repository)
    const fence = executionFence()

    await queue.settle(fence, { kind: 'completed', result: { count: 1 } })
    await queue.settle(fence, {
      kind: 'retry',
      availableAt: new Date('2026-08-15T00:00:00.000Z'),
      errorCode: 'DATABASE_UNAVAILABLE',
      error: 'retry me'
    })
    await queue.settle(fence, { kind: 'failed', errorCode: 'INTERNAL_ERROR', error: 'failed' })
    await queue.settle(fence, { kind: 'skipped', reason: 'PRECONDITION_NOT_MET' })
    await queue.settle(fence, { kind: 'cancelled', message: 'cancelled' })
    await queue.settle(fence, { kind: 'paused', message: 'paused' })
    await queue.settle(fence, { kind: 'released', message: 'shutdown' })

    expect(repository.complete).toHaveBeenCalledWith(expect.objectContaining({ ...fence, result: { count: 1 } }))
    expect(repository.retry).toHaveBeenCalledWith(
      expect.objectContaining({ ...fence, errorCode: 'DATABASE_UNAVAILABLE' })
    )
    expect(repository.fail).toHaveBeenCalledWith(expect.objectContaining({ ...fence, errorCode: 'INTERNAL_ERROR' }))
    expect(repository.skip).toHaveBeenCalledWith(expect.objectContaining({ ...fence, reason: 'PRECONDITION_NOT_MET' }))
    expect(repository.cancel).toHaveBeenCalledWith(expect.objectContaining(fence))
    expect(repository.pause).toHaveBeenCalledWith(expect.objectContaining(fence))
    expect(repository.release).toHaveBeenCalledWith(expect.objectContaining(fence))
  })

  it('validates a child job type before delegating enqueue', async () => {
    const repository = createRepository()
    const queue = new RuntimeDispatcherQueue(repository)

    await queue.enqueueChild(executionFence(), { type: 'SCAN', payload: {} })
    expect(repository.enqueueChild).toHaveBeenCalledWith(
      expect.objectContaining({ jobId: 'job-1' }),
      expect.objectContaining({ type: 'SCAN', payload: {} })
    )
    expect(() => queue.enqueueChild(executionFence(), { type: 'UNKNOWN_JOB', payload: {} })).toThrow()
  })

  it('rejects undefined and unknown settlement outcomes instead of silently leaving a job running', async () => {
    const repository = createRepository()
    const queue = new RuntimeDispatcherQueue(repository)

    expect(() => queue.settle(executionFence(), undefined as never)).toThrow()
    expect(() => queue.settle(executionFence(), { kind: 'mystery' } as never)).toThrow()
    expect(repository.complete).not.toHaveBeenCalled()
    expect(repository.retry).not.toHaveBeenCalled()
    expect(repository.fail).not.toHaveBeenCalled()
  })
})

function createRepository() {
  return {
    claim: vi.fn<QueueRepositoryPort['claim']>(async () => null),
    heartbeat: vi.fn<QueueRepositoryPort['heartbeat']>(async () => new Date('2099-08-14T00:01:00.000Z')),
    updateProgress: vi.fn<QueueRepositoryPort['updateProgress']>(async () => undefined),
    enqueueChild: vi.fn<QueueRepositoryPort['enqueueChild']>(async () => ({
      id: 'child-1',
      created: true
    })),
    readExecutionControl: vi.fn<QueueRepositoryPort['readExecutionControl']>(async () => ({
      status: 'RUNNING',
      cancelRequestedAt: null,
      pauseRequestedAt: null
    })),
    complete: vi.fn<QueueRepositoryPort['complete']>(async () => undefined),
    retry: vi.fn<QueueRepositoryPort['retry']>(async () => undefined),
    fail: vi.fn<QueueRepositoryPort['fail']>(async () => undefined),
    skip: vi.fn<QueueRepositoryPort['skip']>(async () => undefined),
    cancel: vi.fn<QueueRepositoryPort['cancel']>(async () => undefined),
    pause: vi.fn<QueueRepositoryPort['pause']>(async () => undefined),
    release: vi.fn<QueueRepositoryPort['release']>(async () => undefined)
  } satisfies QueueRepositoryPort
}

function executionFence(): ExecutionFence {
  return {
    jobId: 'job-1',
    workerId: 'worker-1',
    executionToken: '00000000-0000-4000-8000-000000000001',
    attempt: 1
  }
}
