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

import { resolveVideoStreamingOptimizationTarget } from '../video-streaming-optimization-service'

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
})
