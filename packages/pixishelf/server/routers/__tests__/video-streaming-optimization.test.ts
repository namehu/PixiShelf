import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  enqueue: vi.fn(),
  cancel: vi.fn(),
  getLatestJob: vi.fn(),
  getLatestJobsByImageIds: vi.fn(),
  listQueue: vi.fn(),
  resolveProbePath: vi.fn(),
  cancelCentralChapter: vi.fn(),
  getActiveJobByType: vi.fn(),
  cancelLegacyJob: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimiter: { check: vi.fn(() => true) }
}))

vi.mock('@/lib/logger', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() }
}))

vi.mock('@/services/video-media-probe-service', () => ({
  reprobeVideoMediaByImageId: vi.fn(),
  resolveVideoImageForReprobePath: mocks.resolveProbePath
}))

vi.mock('@/services/video-streaming-optimization-queue', () => ({
  enqueueVideoOptimization: mocks.enqueue,
  cancelVideoOptimization: mocks.cancel
}))

vi.mock('@/services/video-processing-central-service', () => ({
  cancelActiveCentralVideoChapterPreview: mocks.cancelCentralChapter
}))

vi.mock('@/services/job-service', () => ({
  getLatestVideoStreamingOptimizationJob: mocks.getLatestJob,
  getLatestVideoStreamingOptimizationJobsByImageIds: mocks.getLatestJobsByImageIds,
  listVideoStreamingOptimizationQueue: mocks.listQueue,
  getActiveJobByType: mocks.getActiveJobByType,
  cancelJob: mocks.cancelLegacyJob
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
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    mocks.enqueue.mockResolvedValue({
      jobId: 'job-7',
      imageId: 9,
      path: '/artist/work/video.mp4',
      status: 'PENDING',
      queuePosition: 2,
      reused: false
    })
    mocks.cancel.mockResolvedValue({ changed: true, job: { id: 'job-7', status: 'CANCELLED' } })
    mocks.listQueue.mockResolvedValue({ capacity: 100, active: [], recent: [] })
  })

  it('adds the requested video to the persistent queue', async () => {
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.startVideoStreamingOptimization({ imageId: 9 })).resolves.toEqual({
      jobId: 'job-7',
      imageId: 9,
      path: '/artist/work/video.mp4',
      status: 'PENDING',
      queuePosition: 2,
      reused: false
    })
    expect(mocks.enqueue).toHaveBeenCalledWith(9, 'user-1')
  })

  it('returns the existing job when the image is already queued', async () => {
    mocks.enqueue.mockResolvedValueOnce({
      jobId: 'job-existing',
      imageId: 9,
      path: '/artist/work/video.mp4',
      status: 'RUNNING',
      queuePosition: null,
      reused: true
    })
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.startVideoStreamingOptimization({ imageId: 9 })).resolves.toMatchObject({
      jobId: 'job-existing',
      reused: true
    })
  })

  it('cancels a pending queue item immediately', async () => {
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.cancelVideoStreamingOptimization({ jobId: 'job-7' })).resolves.toEqual({
      success: true,
      status: 'CANCELLED'
    })
    expect(mocks.cancel).toHaveBeenCalledWith('job-7')
  })

  it('routes central streaming start/cancel without tripping the legacy guard', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.startVideoStreamingOptimization({ imageId: 9 })).resolves.toMatchObject({ jobId: 'job-7' })
    await expect(caller.cancelVideoStreamingOptimization({ jobId: 'job-7' })).resolves.toEqual({
      success: true,
      status: 'CANCELLED'
    })
    expect(mocks.enqueue).toHaveBeenCalledWith(9, 'user-1')
    expect(mocks.cancel).toHaveBeenCalledWith('job-7')
  })

  it('uses central chapter cancellation after cutover and keeps the legacy path before cutover', async () => {
    mocks.cancelCentralChapter.mockResolvedValue({ id: 'chapter-central', status: 'CANCELLING' })
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const caller = jobRouter.createCaller(ctx)
    await expect(caller.cancelVideoChapterPreviewGeneration()).resolves.toEqual({ success: true })
    expect(mocks.cancelCentralChapter).toHaveBeenCalledOnce()
    expect(mocks.getActiveJobByType).not.toHaveBeenCalled()

    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    mocks.getActiveJobByType.mockResolvedValue({ id: 'chapter-legacy' })
    await expect(caller.cancelVideoChapterPreviewGeneration()).resolves.toEqual({ success: true })
    expect(mocks.cancelLegacyJob).toHaveBeenCalledWith('chapter-legacy')
  })

  it('returns the latest row-level status for requested media ids', async () => {
    mocks.getLatestJobsByImageIds.mockResolvedValueOnce([{ id: 'job-7', targetImageId: 9, status: 'RUNNING' }])
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.getVideoStreamingOptimizationStatuses({ imageIds: [9, 9, 10] })).resolves.toEqual([
      { id: 'job-7', targetImageId: 9, status: 'RUNNING' }
    ])
    expect(mocks.getLatestJobsByImageIds).toHaveBeenCalledWith([9, 10])
  })

  it('returns the global active and recent queue view', async () => {
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.getVideoStreamingOptimizationQueue()).resolves.toEqual({
      capacity: 100,
      active: [],
      recent: []
    })
  })
})
