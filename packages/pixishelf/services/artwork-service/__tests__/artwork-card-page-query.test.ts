import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'

const { queryRawMock, artworkFindManyMock, imageFindManyMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  artworkFindManyMock: vi.fn(),
  imageFindManyMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: queryRawMock,
    artwork: { findMany: artworkFindManyMock },
    image: { findMany: imageFindManyMock }
  }
}))

import { getArtworkCardsPage } from '../index'

const cardRow = (id: number) => ({
  id,
  title: `artwork ${id}`,
  imageCount: 3,
  images: [
    {
      id: id * 10,
      artworkId: id,
      path: `/artist/${id}_p0.jpg`,
      size: 1024,
      mediaType: 'IMAGE',
      videoMetadata: null
    }
  ],
  artist: { name: 'artist' },
  artworkTags: [{ tag: { name: 'tag' } }]
})

describe('getArtworkCardsPage', () => {
  beforeEach(() => {
    queryRawMock.mockReset()
    artworkFindManyMock.mockReset()
    imageFindManyMock.mockReset()
  })

  it('loads an exact total and only card fields with one cover on the first page', async () => {
    queryRawMock.mockImplementation((query: string) => {
      if (query.includes('COUNT(*)')) return Promise.resolve([{ count: BigInt(3) }])
      return Promise.resolve([{ id: 1 }, { id: 2 }, { id: 3 }])
    })
    artworkFindManyMock.mockResolvedValue([cardRow(2), cardRow(1)])

    const result = await getArtworkCardsPage(ArtworksInfiniteQuerySchema.parse({ pageSize: 2 }))

    expect(queryRawMock).toHaveBeenCalledTimes(2)
    const idQueryCall = queryRawMock.mock.calls.find(([query]) => String(query).includes('SELECT a.id'))
    expect(idQueryCall?.slice(-2)).toEqual([3, 0])
    expect(artworkFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { in: [1, 2] } },
        select: expect.objectContaining({
          id: true,
          title: true,
          imageCount: true,
          images: expect.objectContaining({ take: 1 })
        })
      })
    )
    expect(result).toMatchObject({
      total: 3,
      page: 1,
      pageSize: 2,
      hasNextPage: true
    })
    expect(result.items.map(({ id }) => id)).toEqual([1, 2])
    expect(result.items[0]?.images).toHaveLength(1)
  })

  it('skips COUNT on later pages and uses the extra row to determine the next page', async () => {
    queryRawMock.mockResolvedValue([{ id: 3 }])
    artworkFindManyMock.mockResolvedValue([cardRow(3)])

    const result = await getArtworkCardsPage(
      ArtworksInfiniteQuerySchema.parse({
        cursor: 2,
        pageSize: 2
      })
    )

    expect(queryRawMock).toHaveBeenCalledTimes(1)
    expect(String(queryRawMock.mock.calls[0]?.[0])).not.toContain('COUNT(*)')
    expect(result).toEqual({
      items: [
        {
          id: 3,
          title: 'artwork 3',
          imageCount: 3,
          totalMediaSize: 1024,
          images: [{ path: '/artist/3_p0.jpg', size: 1024, mediaType: 'image', posterUrl: null }],
          artist: { name: 'artist' },
          tags: [{ name: 'tag' }]
        }
      ],
      total: undefined,
      page: 2,
      pageSize: 2,
      hasNextPage: false
    })
  })

  it('uses a same-name video as the logical cover when the first stored media is APNG', async () => {
    queryRawMock.mockImplementation((query: string) => {
      if (query.includes('COUNT(*)')) return Promise.resolve([{ count: BigInt(1) }])
      return Promise.resolve([{ id: 1 }])
    })
    artworkFindManyMock.mockResolvedValue([
      {
        ...cardRow(1),
        images: [
          {
            id: 10,
            artworkId: 1,
            path: '/artist/animation.apng',
            size: 2048,
            mediaType: 'ANIMATION',
            videoMetadata: null
          }
        ]
      }
    ])
    imageFindManyMock.mockResolvedValue([
      {
        id: 11,
        artworkId: 1,
        path: '/artist/animation.webm',
        size: 1024,
        mediaType: 'VIDEO',
        videoMetadata: null
      }
    ])

    const result = await getArtworkCardsPage(ArtworksInfiniteQuerySchema.parse({ pageSize: 24 }))

    expect(imageFindManyMock).toHaveBeenCalledOnce()
    expect(result.items[0]).toMatchObject({
      imageCount: 0,
      totalMediaSize: 1024,
      images: [{ path: '/artist/animation.webm', mediaType: 'video' }]
    })
  })

  it('rejects artwork list pages larger than 100 items', () => {
    expect(() => ArtworksInfiniteQuerySchema.parse({ pageSize: 101 })).toThrow()
    expect(ArtworksInfiniteQuerySchema.parse({ pageSize: 100 }).pageSize).toBe(100)
  })
})
