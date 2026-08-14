import { beforeEach, describe, expect, it, vi } from 'vitest'

const { discover, generate } = vi.hoisted(() => ({ discover: vi.fn(), generate: vi.fn() }))
vi.mock('../discovery.js', async (importOriginal) => ({
  ...(await importOriginal()),
  discoverVideoKeyframes: discover
}))
vi.mock('../generation.js', async (importOriginal) => ({
  ...(await importOriginal()),
  generateVideoKeyframes: generate
}))

import type { ExecutorDefinition } from '@pixishelf/job-runtime'
import { createVideoKeyframeExecutorRegistrations } from '../executors.js'
import { VideoKeyframePermanentError } from '../types.js'

describe('video keyframe executors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    discover.mockResolvedValue({ matched: 1, enqueued: 1, inaccessible: 0 })
  })

  it('publishes domain state before completing through the same fenced transaction', async () => {
    const order: string[] = []
    generate.mockResolvedValue({
      result: { setId: 'set-1' },
      publish: vi.fn(async () => order.push('publish'))
    })
    const definition = generationDefinition()
    const context = executionContext({
      payload: { imageId: 1, relativePath: 'videos/1.mp4', mode: 'MANUAL_INCREMENTAL' },
      finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
        await operation({
          transaction: transaction(),
          executionStatus: 'RUNNING',
          controlStatus: 'CONTINUE',
          complete: async () => order.push('complete'),
          fail: vi.fn(),
          pause: vi.fn(),
          cancel: vi.fn()
        })
        return { kind: 'transactionally-finalized' as const }
      }
    })

    await expect(definition.execute(context as never)).resolves.toEqual({ kind: 'transactionally-finalized' })
    expect(order).toEqual(['publish', 'complete'])
  })

  it('does not publish when pause wins immediately before the fenced finalization lock', async () => {
    const publish = vi.fn()
    const pause = vi.fn().mockResolvedValue(undefined)
    const complete = vi.fn()
    const updateMany = vi.fn()
    generate.mockResolvedValue({ result: { setId: 'set-1' }, publish })
    const context = executionContext({
      payload: { imageId: 1, relativePath: 'videos/1.mp4', mode: 'MANUAL_INCREMENTAL' },
      finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
        await operation({
          transaction: transaction(updateMany),
          executionStatus: 'PAUSING',
          controlStatus: 'PAUSE_REQUESTED',
          complete,
          fail: vi.fn(),
          pause,
          cancel: vi.fn()
        })
        return { kind: 'transactionally-finalized' as const }
      }
    })

    await expect(generationDefinition().execute(context as never)).resolves.toEqual({
      kind: 'transactionally-finalized'
    })
    expect(publish).not.toHaveBeenCalled()
    expect(updateMany).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(pause).toHaveBeenCalledWith(expect.objectContaining({ reason: 'USER_REQUESTED' }))
  })

  it('atomically marks staging failed and cancels when cancellation wins before publication', async () => {
    const publish = vi.fn()
    const cancel = vi.fn().mockResolvedValue(undefined)
    const complete = vi.fn()
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    generate.mockResolvedValue({ result: { setId: 'set-1' }, publish })
    const context = executionContext({
      payload: { imageId: 1, relativePath: 'videos/1.mp4', mode: 'MANUAL_INCREMENTAL' },
      finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
        await operation({
          transaction: transaction(updateMany),
          executionStatus: 'CANCELLING',
          controlStatus: 'CANCEL_REQUESTED',
          complete,
          fail: vi.fn(),
          pause: vi.fn(),
          cancel
        })
        return { kind: 'transactionally-finalized' as const }
      }
    })

    await expect(generationDefinition().execute(context as never)).resolves.toEqual({
      kind: 'transactionally-finalized'
    })
    expect(publish).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    expect(updateMany).toHaveBeenCalledWith({
      where: { systemJobId: 'job-1', status: 'STAGING' },
      data: { status: 'FAILED', error: '视频代表帧生成已取消；派生文件等待后续 GC' }
    })
    expect(cancel).toHaveBeenCalledWith('视频代表帧生成已取消')
  })

  it('atomically marks the staging set failed for a permanent failure', async () => {
    generate.mockRejectedValue(new VideoKeyframePermanentError('NOT_A_VIDEO', 'not a video'))
    const updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const fail = vi.fn().mockResolvedValue(undefined)
    const context = executionContext({
      payload: { imageId: 1, relativePath: 'videos/1.mp4', mode: 'MANUAL_INCREMENTAL' },
      finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
        await operation({
          transaction: transaction(updateMany),
          executionStatus: 'RUNNING',
          controlStatus: 'CONTINUE',
          complete: vi.fn(),
          fail,
          pause: vi.fn(),
          cancel: vi.fn()
        })
        return { kind: 'transactionally-finalized' as const }
      }
    })

    await expect(generationDefinition().execute(context as never)).resolves.toEqual({
      kind: 'transactionally-finalized'
    })
    expect(updateMany).toHaveBeenCalledWith({
      where: { systemJobId: 'job-1', status: 'STAGING' },
      data: { status: 'FAILED', error: 'not a video' }
    })
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ errorCode: 'PRECONDITION_FAILED' }))
  })

  it('returns a bounded retry for a transient failure without finalizing domain state', async () => {
    generate.mockRejectedValue(new Error('temporary database failure'))
    const context = executionContext({
      payload: { imageId: 1, relativePath: 'videos/1.mp4', mode: 'MANUAL_INCREMENTAL' },
      now: new Date('2026-08-14T00:00:00.000Z')
    })
    await expect(generationDefinition().execute(context as never)).resolves.toMatchObject({
      kind: 'retry',
      availableAt: new Date('2026-08-14T00:00:15.000Z'),
      errorCode: 'INTERNAL_ERROR'
    })
    expect(context.finalizeInTransaction).not.toHaveBeenCalled()
  })

  it.each([
    ['PAUSING', 'PAUSE_REQUESTED', 'pause'],
    ['CANCELLING', 'CANCEL_REQUESTED', 'cancel'],
    ['RUNNING', 'CONTINUE', 'release']
  ] as const)(
    'atomically settles a running generation interrupted with locked %s control',
    async (executionStatus, controlStatus, finalizer) => {
      const controller = new AbortController()
      const reason = new Error('generation interrupted after staging')
      const updateMany = vi.fn().mockResolvedValue({ count: 1 })
      const pause = vi.fn().mockResolvedValue(undefined)
      const cancel = vi.fn().mockResolvedValue(undefined)
      const release = vi.fn().mockResolvedValue(undefined)
      generate.mockImplementation(async () => {
        controller.abort(reason)
        throw reason
      })
      const context = executionContext({
        signal: controller.signal,
        payload: { imageId: 1, relativePath: 'videos/1.mp4', mode: 'MANUAL_INCREMENTAL' },
        finalizeInTransaction: async (operation: (scope: unknown) => Promise<void>) => {
          await operation({
            transaction: transaction(updateMany),
            executionStatus,
            controlStatus,
            complete: vi.fn(),
            fail: vi.fn(),
            pause,
            cancel,
            release
          })
          return { kind: 'transactionally-finalized' as const }
        }
      })

      await expect(generationDefinition().execute(context as never)).resolves.toEqual({
        kind: 'transactionally-finalized'
      })
      expect({ pause, cancel, release }[finalizer]).toHaveBeenCalledOnce()
      if (executionStatus === 'CANCELLING') {
        expect(updateMany).toHaveBeenCalledWith({
          where: { systemJobId: 'job-1', status: 'STAGING' },
          data: { status: 'FAILED', error: '视频代表帧生成已取消；派生文件等待后续 GC' }
        })
      } else {
        expect(updateMany).not.toHaveBeenCalled()
      }
    }
  )

  it('lets a lost execution fence reject interrupted-generation finalization without domain writes', async () => {
    const controller = new AbortController()
    const interruption = new Error('lease lost')
    const staleFence = new Error('stale execution fence')
    controller.abort(interruption)
    generate.mockRejectedValue(interruption)
    const context = executionContext({
      signal: controller.signal,
      payload: { imageId: 1, relativePath: 'videos/1.mp4', mode: 'MANUAL_INCREMENTAL' },
      finalizeInTransaction: vi.fn().mockRejectedValue(staleFence)
    })

    await expect(generationDefinition().execute(context as never)).rejects.toBe(staleFence)
    expect(context.finalizeInTransaction).toHaveBeenCalledOnce()
  })
})

function generationDefinition() {
  return definitions().find((definition) => definition.jobType === 'VIDEO_KEYFRAME_GENERATION')!
}

function definitions(): ExecutorDefinition[] {
  return createVideoKeyframeExecutorRegistrations({
    database: {} as never,
    config: { scanRoot: '/scan', keyframeStorageRoot: '/keyframes', ffmpegThreads: 2 },
    now: () => new Date('2026-08-14T00:00:00.000Z')
  })
}

function executionContext(overrides: Record<string, unknown> = {}) {
  const signal = (overrides.signal as AbortSignal | undefined) ?? new AbortController().signal
  return {
    job: { id: 'job-1', attempt: 1, maxAttempts: 3 },
    payload: overrides.payload,
    signal,
    progress: vi.fn().mockResolvedValue(undefined),
    enqueueChild: vi.fn(),
    mutateInTransaction: vi.fn(async (operation: (tx: unknown) => Promise<unknown>) => operation(transaction())),
    finalizeInTransaction: vi.fn(),
    logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    ...overrides
  }
}

function transaction(updateMany = vi.fn()) {
  return { mediaVideoKeyframeSet: { updateMany } }
}
