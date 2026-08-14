import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getScanPath: vi.fn(),
  claimNext: vi.fn(),
  recoverStale: vi.fn(),
  deleteExpired: vi.fn(),
  touchHeartbeat: vi.fn(),
  updateProgress: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  markAsCancelled: vi.fn(),
  getJob: vi.fn(),
  optimize: vi.fn(),
  recoverArtifacts: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.getScanPath }))
vi.mock('@/services/job-service', () => ({
  claimNextVideoStreamingOptimizationJob: mocks.claimNext,
  recoverStaleVideoStreamingOptimizationJobs: mocks.recoverStale,
  deleteExpiredVideoStreamingOptimizationJobs: mocks.deleteExpired,
  touchJobHeartbeat: mocks.touchHeartbeat,
  updateProgress: mocks.updateProgress,
  completeJob: mocks.completeJob,
  failJob: mocks.failJob,
  markAsCancelled: mocks.markAsCancelled,
  getJob: mocks.getJob
}))
vi.mock('@/services/video-streaming-optimization-service', () => ({
  optimizeVideoForStreaming: mocks.optimize,
  recoverInterruptedVideoOptimization: mocks.recoverArtifacts,
  resolveVideoStreamingOptimizationTarget: vi.fn()
}))

import { drainVideoOptimizationQueue } from '../video-streaming-optimization-queue'

describe('video streaming optimization queue processor', () => {
  beforeEach(() => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    vi.clearAllMocks()
    mocks.getScanPath.mockResolvedValue('/scan-root')
    mocks.recoverStale.mockResolvedValue([])
    mocks.deleteExpired.mockResolvedValue({ count: 0 })
    mocks.touchHeartbeat.mockResolvedValue(undefined)
    mocks.updateProgress.mockResolvedValue(undefined)
    mocks.completeJob.mockResolvedValue(undefined)
    mocks.failJob.mockResolvedValue(undefined)
    mocks.markAsCancelled.mockResolvedValue(undefined)
    mocks.getJob.mockResolvedValue(null)
    mocks.recoverArtifacts.mockResolvedValue(undefined)
  })

  it('rejects the legacy processor before claiming work after central cutover', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')

    await expect(drainVideoOptimizationQueue()).rejects.toThrow('Legacy background execution is disabled')
    expect(mocks.getScanPath).not.toHaveBeenCalled()
    expect(mocks.claimNext).not.toHaveBeenCalled()
  })

  it('continues FIFO processing after one video fails', async () => {
    const first = { id: 'job-1', targetImageId: 1, targetPath: '/one.mp4' }
    const second = { id: 'job-2', targetImageId: 2, targetPath: '/two.mp4' }
    mocks.claimNext.mockResolvedValueOnce(first).mockResolvedValueOnce(second).mockResolvedValueOnce(null)
    mocks.optimize
      .mockRejectedValueOnce(new Error('broken container'))
      .mockResolvedValueOnce({ imageId: 2, path: '/two.mp4' })

    await drainVideoOptimizationQueue()

    expect(mocks.optimize).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ imageId: 1, scanPath: '/scan-root', operationId: 'job-1' })
    )
    expect(mocks.optimize).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ imageId: 2, scanPath: '/scan-root', operationId: 'job-2' })
    )
    expect(mocks.failJob).toHaveBeenCalledWith('job-1', 'broken container')
    expect(mocks.completeJob).toHaveBeenCalledWith('job-2', { imageId: 2, path: '/two.mp4' })
  })

  it('recovers stale artifacts before claiming the next queued video', async () => {
    mocks.recoverStale.mockResolvedValueOnce([{ id: 'stale-job', targetImageId: 7, targetPath: '/stale.mp4' }])
    mocks.claimNext.mockResolvedValueOnce(null)

    await drainVideoOptimizationQueue()

    expect(mocks.recoverArtifacts).toHaveBeenCalledWith({
      imageId: 7,
      scanPath: '/scan-root',
      operationId: 'stale-job'
    })
    expect(mocks.claimNext.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.recoverArtifacts.mock.invocationCallOrder[0]!
    )
  })
})
