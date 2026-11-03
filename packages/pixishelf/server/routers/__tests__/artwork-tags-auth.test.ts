import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ update: vi.fn(), allowed: vi.fn(() => true) }))
vi.mock('@/lib/rate-limit', () => ({ rateLimiter: { check: mocks.allowed } }))
vi.mock('@/lib/logger', () => ({ default: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }))
vi.mock('@/services/artwork-service/tags', () => ({ updateArtworkTags: mocks.update }))
vi.mock('@/services/artwork-service', () => ({
  createArtwork: vi.fn(),
  deleteArtwork: vi.fn(),
  previewDeleteArtwork: vi.fn(),
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
  previewDeleteImage: vi.fn(),
  reorderArtworkImages: vi.fn()
}))

import { artworkRouter } from '../artwork'

const authorized = {
  session: { id: 'session' },
  user: { id: 'owner' },
  userId: 'owner',
  headers: new Headers()
} as never
const unauthorized = {
  session: null,
  user: null,
  userId: undefined,
  headers: new Headers({ 'x-user-session': '{"userId":"forged-admin"}' })
} as never

beforeEach(() => {
  vi.clearAllMocks()
  mocks.allowed.mockReturnValue(true)
})
describe('detail tag mutation authorization', () => {
  it('rejects a missing session despite forged identity before the write service', async () => {
    await expect(
      artworkRouter.createCaller(unauthorized).updateTags({ artworkId: 42, newTagNames: ['new'] })
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('normalizes authenticated input once and returns the saved tag DTOs', async () => {
    const saved = [{ id: 2, name: 'new', name_zh: null }]
    mocks.update.mockResolvedValue(saved)
    await expect(
      artworkRouter.createCaller(authorized).updateTags({ artworkId: 42, newTagNames: [' new ', 'new'] })
    ).resolves.toEqual(saved)
    expect(mocks.update).toHaveBeenCalledWith({ artworkId: 42, addTagIds: [], removeTagIds: [], newTagNames: ['new'] })
  })
  it.each([
    { artworkId: 42, addTagIds: [2], removeTagIds: [2] },
    { artworkId: 42, newTagNames: ['  '] },
    { artworkId: -1, addTagIds: [2] }
  ])('rejects invalid input before writes: %j', async (input) => {
    await expect(artworkRouter.createCaller(authorized).updateTags(input)).rejects.toMatchObject({
      code: 'BAD_REQUEST'
    })
    expect(mocks.update).not.toHaveBeenCalled()
  })
  it('blocks rate-limited calls before writes', async () => {
    mocks.allowed.mockReturnValue(false)
    await expect(
      artworkRouter.createCaller(authorized).updateTags({ artworkId: 42, addTagIds: [2] })
    ).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' })
    expect(mocks.update).not.toHaveBeenCalled()
  })
})
