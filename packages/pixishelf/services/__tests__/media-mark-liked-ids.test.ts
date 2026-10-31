import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ artwork: vi.fn(), marks: vi.fn() }))
vi.mock('@/lib/prisma', () => ({
  prisma: { $transaction: (callback: (tx: unknown) => unknown) => callback({
    artwork: { findUnique: mocks.artwork }, mediaMark: { findMany: mocks.marks }
  }) }
}))
import { getLikedMediaIds } from '../media-mark-service'

const image = (id: number, path = `/${id}.jpg`, mediaType = 'IMAGE') => ({
  id, path, mediaType, webpAnimationStatus: null, summaryFeature: null, contentSource: null
})
beforeEach(() => {
  vi.resetAllMocks()
  mocks.artwork.mockResolvedValue({ id: 7, title: 'Synthetic', visualSummary: null, contentSource: null,
    images: [image(1), image(2), image(3, '/paired.mp4', 'VIDEO'), image(4, '/paired.apng', 'ANIMATION')] })
})

describe('liked media membership', () => {
  it('returns current logical identities in artwork order using only the account\'s likes', async () => {
    mocks.marks.mockResolvedValue([{ mediaId: 4 }, { mediaId: 2 }, { mediaId: 999 }])
    expect(await getLikedMediaIds('alice', 7)).toEqual({ mediaIds: [2, 3] })
    expect(mocks.marks).toHaveBeenCalledWith({
      where: { userId: 'alice', artworkId: 7, likedAt: { not: null }, mediaId: { not: null } },
      select: { mediaId: true }
    })
    expect(mocks.artwork.mock.calls[0]?.[0].where).toMatchObject({ id: 7, deletedAt: null, archiveLifecycleState: 'ACTIVE' })
  })

  it('returns likes beyond the first media page and the 200-item hydration limit', async () => {
    mocks.artwork.mockResolvedValue({ id: 7, visualSummary: null, contentSource: null,
      images: Array.from({ length: 600 }, (_, index) => image(index + 1)) })
    mocks.marks.mockResolvedValue([{ mediaId: 599 }, { mediaId: 237 }])
    expect(await getLikedMediaIds('alice', 7)).toEqual({ mediaIds: [237, 599] })
  })

  it('rejects inactive artworks before looking up marks', async () => {
    mocks.artwork.mockResolvedValue(null)
    await expect(getLikedMediaIds('alice', 7)).rejects.toMatchObject({ code: 'NOT_FOUND' })
    expect(mocks.marks).not.toHaveBeenCalled()
  })
})
