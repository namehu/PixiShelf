import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  deleteArtwork: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: vi.fn(() => true) } }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/services/setting.service', () => ({ getScanPath: vi.fn() }))
vi.mock('@/services/artwork-service', () => ({
  createArtwork: vi.fn(),
  deleteArtwork: mocks.deleteArtwork,
  getArtworkById: vi.fn(),
  getArtworkCardsPage: vi.fn(),
  getArtworksList: vi.fn(),
  getNeighboringArtworks: vi.fn(),
  getRandomArtworks: vi.fn(),
  getRecommendedArtworks: vi.fn(),
  getViewerFeed: vi.fn(),
  updateArtwork: vi.fn()
}))
vi.mock('@/services/artwork-service/image-manager', () => ({
  addImageWithChapters: vi.fn(),
  deleteImage: vi.fn(),
  reorderArtworkImages: vi.fn()
}))
vi.mock('@/services/video-media-probe-service', () => ({
  reprobeVideoMediaByImageId: vi.fn(),
  resolveVideoImageForReprobeId: vi.fn()
}))
vi.mock('@/services/video-media-central-service', () => ({ enqueueCentralVideoMediaReprobe: vi.fn() }))

import { artworkRouter } from '../artwork'

const authorized = {
  session: { id: 'session-1' },
  user: { id: 'admin-1' },
  userId: 'admin-1',
  headers: new Headers()
} as never
const unauthorized = { session: null, user: null, userId: undefined, headers: new Headers() } as never

describe('artwork delete authorization boundary', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.deleteArtwork.mockResolvedValue({ id: 42 })
  })

  it('rejects unauthenticated deletion before the write service boundary', async () => {
    await expect(artworkRouter.createCaller(unauthorized).delete(42)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mocks.deleteArtwork).not.toHaveBeenCalled()
  })

  it('passes the authenticated administrator identity to the delete command', async () => {
    await expect(artworkRouter.createCaller(authorized).delete(42)).resolves.toEqual({ id: 42 })
    expect(mocks.deleteArtwork).toHaveBeenCalledWith(42, { requestedByUserId: 'admin-1' })
  })
})
