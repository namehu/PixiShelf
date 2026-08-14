import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueueCentral: vi.fn(),
  control: vi.fn(),
  getScanPath: vi.fn(),
  resolveTarget: vi.fn(),
  enqueueLegacy: vi.fn(),
  cancelLegacy: vi.fn(),
  claimNext: vi.fn(),
  recoverStale: vi.fn(),
  deleteExpired: vi.fn(),
  optimize: vi.fn(),
  recover: vi.fn(),
  getJob: vi.fn(),
  touch: vi.fn(),
  progress: vi.fn(),
  complete: vi.fn(),
  fail: vi.fn(),
  cancelled: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), warn: vi.fn() } }))
vi.mock('@/services/setting.service', () => ({ getScanPath: mocks.getScanPath }))
vi.mock('@/services/video-processing-central-service', () => ({
  enqueueCentralVideoStreamingOptimization: mocks.enqueueCentral,
  controlCentralVideoProcessingJob: mocks.control
}))
vi.mock('@/services/video-streaming-optimization-service', () => ({
  resolveVideoStreamingOptimizationTarget: mocks.resolveTarget,
  optimizeVideoForStreaming: mocks.optimize,
  recoverInterruptedVideoOptimization: mocks.recover
}))
vi.mock('@/services/job-service', () => ({
  enqueueVideoStreamingOptimizationJob: mocks.enqueueLegacy,
  cancelVideoStreamingOptimizationJob: mocks.cancelLegacy,
  claimNextVideoStreamingOptimizationJob: mocks.claimNext,
  recoverStaleVideoStreamingOptimizationJobs: mocks.recoverStale,
  deleteExpiredVideoStreamingOptimizationJobs: mocks.deleteExpired,
  getJob: mocks.getJob,
  touchJobHeartbeat: mocks.touch,
  updateProgress: mocks.progress,
  completeJob: mocks.complete,
  failJob: mocks.fail,
  markAsCancelled: mocks.cancelled
}))

import { enqueueVideoOptimization } from '../video-streaming-optimization-queue'

describe('video streaming queue cutover adapter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    mocks.getScanPath.mockResolvedValue('/scan')
    mocks.resolveTarget.mockResolvedValue({ id: 7, path: 'video.mp4', sourcePath: '/scan/video.mp4' })
    mocks.enqueueLegacy.mockResolvedValue({
      job: { id: 'legacy-job', status: 'PENDING' },
      queuePosition: 1,
      reused: false
    })
    mocks.claimNext.mockResolvedValue(null)
    mocks.recoverStale.mockResolvedValue([])
    mocks.deleteExpired.mockResolvedValue({ count: 0 })
  })

  it('preserves the legacy consumer while cutover is false', async () => {
    await expect(enqueueVideoOptimization(7, 'admin-1')).resolves.toMatchObject({
      jobId: 'legacy-job',
      status: 'PENDING'
    })
    expect(mocks.enqueueLegacy).toHaveBeenCalledWith({ imageId: 7, path: 'video.mp4' })
    expect(mocks.enqueueCentral).not.toHaveBeenCalled()
  })

  it('only enqueues central work when cutover is true', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    mocks.enqueueCentral.mockResolvedValue({
      jobId: 'central-job',
      imageId: 7,
      path: 'video.mp4',
      status: 'PENDING',
      reused: false
    })
    await expect(enqueueVideoOptimization(7, 'admin-1')).resolves.toMatchObject({
      jobId: 'central-job',
      status: 'PENDING',
      queuePosition: null
    })
    expect(mocks.enqueueCentral).toHaveBeenCalledWith({ imageId: 7, requestedByUserId: 'admin-1' })
    expect(mocks.enqueueLegacy).not.toHaveBeenCalled()
    expect(mocks.claimNext).not.toHaveBeenCalled()
  })
})
