import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getScanPathMock, reprobeVideoMediaByImageIdMock, resolveVideoImageForReprobePathMock } = vi.hoisted(() => ({
  getScanPathMock: vi.fn(),
  reprobeVideoMediaByImageIdMock: vi.fn(),
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
  resolveVideoImageForReprobePath: resolveVideoImageForReprobePathMock
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

vi.mock('@/services/job-service', () => ({}))
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

const ctx = {
  session: { id: 'session-1' },
  user: { id: 'user-1' },
  userId: 'user-1',
  headers: new Headers()
} as any

describe('video media reprobe routers', () => {
  beforeEach(() => {
    getScanPathMock.mockReset().mockResolvedValue('/scan-root')
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
  })

  it('reprobes a video by image id through artwork router', async () => {
    const caller = artworkRouter.createCaller(ctx)

    await expect(caller.reprobeVideoMedia({ imageId: 9 })).resolves.toMatchObject({
      imageId: 9,
      probeStatus: 'COMPLETED',
      hasAudio: false
    })
    expect(reprobeVideoMediaByImageIdMock).toHaveBeenCalledWith(9, '/scan-root')
  })

  it('resolves a path and reprobes the matched video through job router', async () => {
    const caller = jobRouter.createCaller(ctx)

    await expect(caller.reprobeVideoMediaByPath({ path: '/artist/work/video.mp4' })).resolves.toMatchObject({
      imageId: 9,
      probeStatus: 'COMPLETED'
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
})
