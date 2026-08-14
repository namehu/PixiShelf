import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  imageFindUnique: vi.fn(),
  resolvePath: vi.fn(),
  prepare: vi.fn(),
  publish: vi.fn(),
  rollback: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    image: { findUnique: mocks.imageFindUnique, update: vi.fn() },
    $transaction: (operation: (transaction: object) => unknown) => operation({})
  }
}))
vi.mock('@/lib/safe-path', () => ({ resolveExistingPathWithinRoot: mocks.resolvePath }))
vi.mock('@pixishelf/job-executors', () => ({
  prepareVideoStreamingOptimization: mocks.prepare,
  recoverVideoStreamingOptimizationArtifacts: vi.fn(),
  runVideoProcess: vi.fn()
}))

import {
  optimizeVideoForStreaming,
  resolveVideoStreamingOptimizationTarget
} from '../video-streaming-optimization-service'

describe('video streaming optimization request validation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    mocks.resolvePath.mockResolvedValue('/scan/video.mp4')
    mocks.publish.mockReset().mockResolvedValue(undefined)
    mocks.rollback.mockReset().mockResolvedValue(undefined)
    mocks.prepare.mockResolvedValue({
      result: { imageId: 7, path: 'video.mp4' },
      publish: mocks.publish,
      rollback: mocks.rollback
    })
  })

  it('validates an MP4 target without invoking a media process', async () => {
    mocks.imageFindUnique.mockResolvedValue({ id: 7, path: 'video.mp4', mediaType: 'VIDEO' })

    await expect(resolveVideoStreamingOptimizationTarget(7, '/scan')).resolves.toEqual({
      id: 7,
      path: 'video.mp4',
      sourcePath: '/scan/video.mp4'
    })
  })

  it('rejects a non-MP4 target before path resolution', async () => {
    mocks.imageFindUnique.mockResolvedValue({ id: 7, path: 'video.mkv', mediaType: 'VIDEO' })

    await expect(resolveVideoStreamingOptimizationTarget(7, '/scan')).rejects.toThrow('Only MP4')
    expect(mocks.resolvePath).not.toHaveBeenCalled()
  })

  it('keeps legacy execution available only before central cutover', async () => {
    mocks.imageFindUnique.mockResolvedValue({ id: 7, path: 'video.mp4', mediaType: 'VIDEO' })
    await expect(
      optimizeVideoForStreaming({ imageId: 7, scanPath: '/scan', operationId: 'legacy-job' })
    ).resolves.toMatchObject({ imageId: 7 })
    expect(mocks.prepare).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'legacy-job' }))
    expect(mocks.prepare.mock.calls[0]![0]).not.toHaveProperty('systemJobId')
    expect(mocks.publish).toHaveBeenCalled()

    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    await expect(optimizeVideoForStreaming({ imageId: 7, scanPath: '/scan' })).rejects.toThrow(
      'Legacy background execution is disabled'
    )
  })

  it('surfaces a legacy publication rollback failure', async () => {
    mocks.imageFindUnique.mockResolvedValue({ id: 7, path: 'video.mp4', mediaType: 'VIDEO' })
    mocks.publish.mockRejectedValue(new Error('publication failed'))
    mocks.rollback.mockRejectedValue(new Error('restore failed'))

    await expect(
      optimizeVideoForStreaming({ imageId: 7, scanPath: '/scan', operationId: 'legacy-job' })
    ).rejects.toMatchObject({
      name: 'AggregateError',
      message: 'Video streaming optimization failed and the original file could not be restored'
    })
  })
})
