import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDashboardRecentArtworks, getRecentArtworks } from '../index'

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
        images: [
          {
            id: 10,
            path: '/artist/card_p0.jpg',
            size: 1024,
            mediaType: 'IMAGE',
            videoMetadata: null
          }
        ],
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
    expect(query.select.images.select.videoMetadata.select).toEqual({
      posterStatus: true,
      posterPath: true,
      posterUpdatedAt: true
    })
    expect(result).toEqual({
      items: [
        {
          id: 1,
          title: 'card',
          imageCount: 8,
          totalMediaSize: 1024,
          images: [{ path: '/artist/card_p0.jpg', size: 1024, mediaType: 'image', posterUrl: null }],
          artist: { name: 'artist' },
          tags: [{ name: 'preferred' }]
        }
      ],
      total: 15000,
      page: 1,
      pageSize: 10
    })
  })

  it('returns a generated poster for a video card without exposing a video fallback cover', async () => {
    artworkCountMock.mockResolvedValue(1)
    artworkFindManyMock.mockResolvedValue([
      {
        id: 2,
        title: 'video card',
        imageCount: 1,
        images: [
          {
            id: 20,
            path: '/artist/video.mp4',
            size: 2048,
            mediaType: 'VIDEO',
            videoMetadata: {
              posterStatus: 'COMPLETED',
              posterPath: '20-cover.webp',
              posterUpdatedAt: new Date('2026-08-08T01:02:03.000Z')
            }
          }
        ],
        artist: { name: 'artist' },
        artworkTags: []
      }
    ])

    const result = await getRecentArtworks({ page: 1, pageSize: 10 })

    expect(result.items[0]?.images[0]).toMatchObject({
      path: '/artist/video.mp4',
      mediaType: 'video',
      posterUrl: '/_video-posters/20-cover.webp?v=1786150923000'
    })
  })

  it('does not count the full artwork table for the dashboard preview', async () => {
    artworkFindManyMock.mockResolvedValue([])

    const result = await getDashboardRecentArtworks({ pageSize: 10 })

    expect(artworkCountMock).not.toHaveBeenCalled()
    expect(artworkFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        take: 10,
        orderBy: [{ sourceDate: 'desc' }, { id: 'desc' }]
      })
    )
    expect(result).toEqual({ items: [], total: 0, page: 1, pageSize: 10 })
  })
})
