import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getRecentArtworks } from '../index'

const { artworkCountMock, artworkFindManyMock } = vi.hoisted(() => ({
  artworkCountMock: vi.fn(),
  artworkFindManyMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artwork: {
      count: artworkCountMock,
      findMany: artworkFindManyMock
    }
  }
}))

describe('dashboard artwork card query', () => {
  beforeEach(() => {
    artworkCountMock.mockReset()
    artworkFindManyMock.mockReset()
  })

  it('selects and returns only fields required by ArtworkCard', async () => {
    artworkCountMock.mockResolvedValue(15000)
    artworkFindManyMock.mockResolvedValue([
      {
        id: 1,
        title: 'card',
        imageCount: 8,
        images: [{ path: '/artist/card_p0.jpg', size: 1024 }],
        artist: { name: 'artist' },
        artworkTags: [{ tag: { name: 'preferred' } }]
      }
    ])

    const result = await getRecentArtworks({ page: 1, pageSize: 10 })

    const query = artworkFindManyMock.mock.calls[0]?.[0]
    expect(query).not.toHaveProperty('include')
    expect(query).toEqual(
      expect.objectContaining({
        take: 10,
        select: expect.objectContaining({
          id: true,
          title: true,
          imageCount: true
        })
      })
    )
    expect(result).toEqual({
      items: [
        {
          id: 1,
          title: 'card',
          imageCount: 8,
          totalMediaSize: 1024,
          images: [{ path: '/artist/card_p0.jpg', size: 1024, mediaType: 'image' }],
          artist: { name: 'artist' },
          tags: [{ name: 'preferred' }]
        }
      ],
      total: 15000,
      page: 1,
      pageSize: 10
    })
  })
})
