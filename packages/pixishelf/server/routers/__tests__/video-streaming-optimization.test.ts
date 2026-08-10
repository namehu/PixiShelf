import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  cancelJob: vi.fn(),
  completeJob: vi.fn(),
  createJob: vi.fn(),
  failJob: vi.fn(),
  getActiveJobByType: vi.fn(),
  getJob: vi.fn(),
  getLatestJob: vi.fn(),
  getLatestJobsByImageIds: vi.fn(),
  getScanPath: vi.fn(),
  markAsCancelled: vi.fn(),
  optimizeVideo: vi.fn(),
  resolveProbePath: vi.fn(),
  resolveOptimizationTarget: vi.fn(),
  updateProgress: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimiter: { check: vi.fn(() => true) }
}))

vi.mock('@/lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

vi.mock('@/services/setting.service', () => ({
  getScanPath: mocks.getScanPath
}))

vi.mock('@/services/video-media-probe-service', () => ({
  reprobeVideoMediaByImageId: vi.fn(),
  resolveVideoImageForReprobePath: mocks.resolveProbePath
}))

vi.mock('@/services/video-streaming-optimization-service', () => ({
  optimizeVideoForStreaming: mocks.optimizeVideo,
  resolveVideoStreamingOptimizationTarget: mocks.resolveOptimizationTarget
}))

vi.mock('@/services/job-service', () => ({
  cancelJob: mocks.cancelJob,
  completeJob: mocks.completeJob,
  createVideoStreamingOptimizationJob: mocks.createJob,
  failJob: mocks.failJob,
  getActiveJobByType: mocks.getActiveJobByType,
  getJob: mocks.getJob,
  getLatestVideoStreamingOptimizationJob: mocks.getLatestJob,
  getLatestVideoStreamingOptimizationJobsByImageIds: mocks.getLatestJobsByImageIds,
  markAsCancelled: mocks.markAsCancelled,
  updateProgress: mocks.updateProgress
}))

vi.mock('@/services/scan-service/refill-meta-source', () => ({ refillMetaSource: vi.fn() }))
vi.mock('@/services/media-derived-tag-service', () => ({ syncAllMediaDerivedTags: vi.fn() }))
vi.mock('@/services/scheduled-task-service', () => ({
  listScheduledTasks: vi.fn(),
  triggerScheduledTaskNow: vi.fn(),
  updateScheduledTask: vi.fn()
}))

import { jobRouter } from '../job'

const ctx = {
  session: { id: 'session-1' },
  user: { id: 'user-1' },
  userId: 'user-1',
  headers: new Headers()
} as any

describe('video streaming optimization job router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getScanPath.mockResolvedValue('/scan-root')
    mocks.resolveOptimizationTarget.mockResolvedValue({
      id: 9,
      path: '/artist/work/video.mp4',
      sourcePath: '/scan-root/artist/work/video.mp4'
    })
    mocks.createJob.mockResolvedValue({ id: 'job-7' })
    mocks.getJob.mockResolvedValue({ id: 'job-7', status: 'RUNNING' })
    mocks.optimizeVideo.mockResolvedValue({
      imageId: 9,
      path: '/artist/work/video.mp4',
      originalSize: 200,
      optimizedSize: 190,
      savedBytes: 10
    })
  })

  it('starts the remux in the background and completes the job', async () => {
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.startVideoStreamingOptimization({ imageId: 9 })).resolves.toEqual({
      jobId: 'job-7',
      imageId: 9,
      path: '/artist/work/video.mp4'
    })

    await vi.waitFor(() => expect(mocks.completeJob).toHaveBeenCalledTimes(1))
    expect(mocks.resolveOptimizationTarget).toHaveBeenCalledWith(9, '/scan-root')
    expect(mocks.resolveProbePath).not.toHaveBeenCalled()
    expect(mocks.createJob).toHaveBeenCalledWith({ imageId: 9, path: '/artist/work/video.mp4' })
    expect(mocks.optimizeVideo).toHaveBeenCalledWith(expect.objectContaining({ imageId: 9, scanPath: '/scan-root' }))
    expect(mocks.failJob).not.toHaveBeenCalled()
  })

  it('marks a cancelled background remux as cancelled', async () => {
    mocks.optimizeVideo.mockRejectedValueOnce(new Error('Task cancelled'))
    mocks.getJob.mockResolvedValueOnce({ id: 'job-7', status: 'CANCELLING' })
    const caller = jobRouter.createCaller(ctx)

    await caller.startVideoStreamingOptimization({ imageId: 9 })

    await vi.waitFor(() => expect(mocks.markAsCancelled).toHaveBeenCalledWith('job-7'))
    expect(mocks.failJob).not.toHaveBeenCalled()
  })

  it('requests cancellation for the active optimization job', async () => {
    mocks.getJob.mockResolvedValueOnce({ id: 'job-7', type: 'VIDEO_STREAMING_OPTIMIZATION', status: 'RUNNING' })
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.cancelVideoStreamingOptimization({ jobId: 'job-7' })).resolves.toEqual({ success: true })
    expect(mocks.cancelJob).toHaveBeenCalledWith('job-7')
  })

  it('returns the latest row-level status for requested media ids', async () => {
    mocks.getLatestJobsByImageIds.mockResolvedValueOnce([{ id: 'job-7', targetImageId: 9, status: 'RUNNING' }])
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.getVideoStreamingOptimizationStatuses({ imageIds: [9, 9, 10] })).resolves.toEqual([
      { id: 'job-7', targetImageId: 9, status: 'RUNNING' }
    ])
    expect(mocks.getLatestJobsByImageIds).toHaveBeenCalledWith([9, 10])
  })
})
