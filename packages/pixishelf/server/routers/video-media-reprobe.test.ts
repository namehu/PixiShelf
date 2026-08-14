import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  cancelCentralVideoMediaProbeMock,
  cancelJobMock,
  enqueueCentralVideoMediaReprobeMock,
  getActiveJobByTypeMock,
  getScanPathMock,
  listJobsMock,
  markAsCancelledMock,
  reprobeVideoMediaByImageIdMock,
  resolveVideoImageForReprobeIdMock,
  resolveVideoImageForReprobePathMock
} = vi.hoisted(() => ({
  cancelCentralVideoMediaProbeMock: vi.fn(),
  cancelJobMock: vi.fn(),
  enqueueCentralVideoMediaReprobeMock: vi.fn(),
  getActiveJobByTypeMock: vi.fn(),
  getScanPathMock: vi.fn(),
  listJobsMock: vi.fn(),
  markAsCancelledMock: vi.fn(),
  reprobeVideoMediaByImageIdMock: vi.fn(),
  resolveVideoImageForReprobeIdMock: vi.fn(),
  resolveVideoImageForReprobePathMock: vi.fn()
}))

vi.mock('server-only', () => ({}))

vi.mock('@/lib/rate-limit', () => ({
  rateLimiter: {
    check: vi.fn(() => true)
  }
}))

vi.mock('@/lib/logger', () => ({
  default: {
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn()
  }
}))

vi.mock('@/services/setting.service', () => ({
  getScanPath: getScanPathMock
}))

vi.mock('@/services/video-media-probe-service', () => ({
  reprobeVideoMediaByImageId: reprobeVideoMediaByImageIdMock,
  resolveVideoImageForReprobeId: resolveVideoImageForReprobeIdMock,
  resolveVideoImageForReprobePath: resolveVideoImageForReprobePathMock
}))

vi.mock('@/services/video-media-central-service', () => ({
  cancelCentralVideoMediaProbe: cancelCentralVideoMediaProbeMock,
  enqueueCentralVideoMediaReprobe: enqueueCentralVideoMediaReprobeMock
}))

vi.mock('@/services/background-task', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/services/background-task')>()),
  listJobs: listJobsMock
}))

vi.mock('@/services/artwork-service', () => ({
  getArtworkById: vi.fn(),
  getArtworksList: vi.fn(),
  getNeighboringArtworks: vi.fn(),
  getRecommendedArtworks: vi.fn(),
  getRandomArtworks: vi.fn(),
  getViewerFeed: vi.fn(),
  deleteArtwork: vi.fn(),
  updateArtwork: vi.fn(),
  createArtwork: vi.fn()
}))

vi.mock('@/services/artwork-service/image-manager', () => ({
  addImageWithChapters: vi.fn(),
  deleteImage: vi.fn()
}))

vi.mock('@/services/job-service', () => ({
  cancelJob: cancelJobMock,
  getActiveJobByType: getActiveJobByTypeMock,
  markAsCancelled: markAsCancelledMock
}))
vi.mock('@/services/scan-service/refill-meta-source', () => ({
  refillMetaSource: vi.fn()
}))
vi.mock('@/services/media-derived-tag-service', () => ({
  syncAllMediaDerivedTags: vi.fn()
}))
vi.mock('@/services/scheduled-task-service', () => ({
  listScheduledTasks: vi.fn(),
  triggerScheduledTaskNow: vi.fn(),
  updateScheduledTask: vi.fn()
}))

import { artworkRouter } from './artwork'
import { jobRouter } from './job'
import { BackgroundTaskError } from '@/services/background-task/background-task-error'

const ctx = {
  session: { id: 'session-1' },
  user: { id: 'user-1' },
  userId: 'user-1',
  headers: new Headers()
} as any

describe('video media reprobe routers', () => {
  beforeEach(() => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'false')
    getScanPathMock.mockReset().mockResolvedValue('/scan-root')
    cancelCentralVideoMediaProbeMock.mockReset().mockResolvedValue({ id: 'probe-central', status: 'CANCELLING' })
    cancelJobMock.mockReset().mockResolvedValue(undefined)
    enqueueCentralVideoMediaReprobeMock.mockReset().mockResolvedValue({
      jobId: 'probe-central',
      status: 'PENDING',
      reused: false
    })
    getActiveJobByTypeMock.mockReset().mockResolvedValue({ id: 'probe-legacy' })
    listJobsMock.mockReset().mockResolvedValue({ items: [{ id: 'probe-central', status: 'RUNNING' }] })
    markAsCancelledMock.mockReset().mockResolvedValue(undefined)
    reprobeVideoMediaByImageIdMock.mockReset().mockResolvedValue({
      imageId: 9,
      probeStatus: 'COMPLETED',
      probeUpdatedAt: new Date('2026-06-18T00:00:00.000Z'),
      probeError: null,
      hasAudio: false,
      audioCodec: null,
      audioChannels: null,
      videoCodec: 'h264',
      duration: 8,
      fps: 30
    })
    resolveVideoImageForReprobePathMock.mockReset().mockResolvedValue({
      id: 9,
      path: '/artist/work/video.mp4',
      mediaType: 'VIDEO'
    })
    resolveVideoImageForReprobeIdMock.mockReset().mockResolvedValue({
      id: 9,
      path: '/artist/work/video.mp4',
      mediaType: 'VIDEO'
    })
  })

  it('reprobes a video by image id through artwork router', async () => {
    const caller = artworkRouter.createCaller(ctx)

    await expect(caller.reprobeVideoMedia({ imageId: 9 })).resolves.toMatchObject({
      mode: 'COMPLETED',
      metadata: { imageId: 9, probeStatus: 'COMPLETED', hasAudio: false }
    })
    expect(reprobeVideoMediaByImageIdMock).toHaveBeenCalledWith(9, '/scan-root')
  })

  it('resolves a path and reprobes the matched video through job router', async () => {
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.reprobeVideoMediaByPath({ path: '/artist/work/video.mp4' })).resolves.toMatchObject({
      mode: 'COMPLETED',
      metadata: { imageId: 9, probeStatus: 'COMPLETED' }
    })
    expect(resolveVideoImageForReprobePathMock).toHaveBeenCalledWith('/artist/work/video.mp4', '/scan-root')
    expect(reprobeVideoMediaByImageIdMock).toHaveBeenCalledWith(9, '/scan-root')
  })

  it('maps invalid reprobe targets to bad request errors', async () => {
    resolveVideoImageForReprobePathMock.mockRejectedValueOnce(new Error('Image is not a video'))
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.reprobeVideoMediaByPath({ path: '/artist/work/page.webp' })).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
  })

  it('enqueues durable single-image reprobe work after central cutover', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.reprobeVideoMediaByPath({ path: '/artist/work/video.mp4' })).resolves.toEqual({
      mode: 'QUEUED',
      jobId: 'probe-central',
      status: 'PENDING',
      reused: false
    })
    expect(enqueueCentralVideoMediaReprobeMock).toHaveBeenCalledWith({ imageId: 9, requestedByUserId: 'user-1' })
    expect(reprobeVideoMediaByImageIdMock).not.toHaveBeenCalled()

    await expect(artworkRouter.createCaller(ctx).reprobeVideoMedia({ imageId: 9 })).resolves.toEqual({
      mode: 'QUEUED',
      jobId: 'probe-central',
      status: 'PENDING',
      reused: false
    })
    expect(resolveVideoImageForReprobeIdMock).toHaveBeenCalledWith(9, '/scan-root')
  })

  it('reports a normal-versus-targeted active singleton mismatch as CONFLICT', async () => {
    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    enqueueCentralVideoMediaReprobeMock.mockRejectedValue(
      new BackgroundTaskError('ACTIVE_JOB_CONFLICT', 'A normal probe is already active')
    )

    await expect(
      jobRouter.createCaller(ctx).reprobeVideoMediaByPath({ path: '/artist/work/video.mp4' })
    ).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(artworkRouter.createCaller(ctx).reprobeVideoMedia({ imageId: 9 })).rejects.toMatchObject({
      code: 'CONFLICT'
    })
  })

  it('uses unified cancellation centrally and preserves the legacy fallback before cutover', async () => {
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.cancelVideoMediaProbe()).resolves.toEqual({ success: true })
    expect(cancelJobMock).toHaveBeenCalledWith('probe-legacy')
    expect(markAsCancelledMock).toHaveBeenCalledWith('probe-legacy')

    vi.stubEnv('CENTRAL_DISPATCHER_CUTOVER_ENABLED', 'true')
    await expect(caller.cancelVideoMediaProbe()).resolves.toEqual({ success: true })
    expect(cancelCentralVideoMediaProbeMock).toHaveBeenCalledWith('probe-central')
  })
})
