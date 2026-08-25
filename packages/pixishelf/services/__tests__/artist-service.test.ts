import { beforeEach, describe, expect, it, vi } from 'vitest'
import { getDashboardArtists, updateArtist } from '../artist-service'

const {
  artistAggregateMock,
  artistFindManyMock,
  artworkFindManyMock,
  queryRawMock,
  prismaTransactionMock,
  transactionArtistFindMock,
  transactionArtistUpdateMock
} = vi.hoisted(() => ({
  artistAggregateMock: vi.fn(),
  artistFindManyMock: vi.fn(),
  artworkFindManyMock: vi.fn(),
  queryRawMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
  transactionArtistFindMock: vi.fn(),
  transactionArtistUpdateMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    artist: {
      aggregate: artistAggregateMock,
      findMany: artistFindManyMock
    },
    artwork: {
      findMany: artworkFindManyMock
    },
    $queryRaw: queryRawMock,
    $transaction: prismaTransactionMock
  }
}))

vi.mock('@/lib/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn()
  }
}))

describe('getDashboardArtists', () => {
  beforeEach(() => {
    artistAggregateMock.mockReset().mockResolvedValue({ _min: { id: 1 }, _max: { id: 1 } })
    artistFindManyMock.mockReset()
    artworkFindManyMock.mockReset()
    queryRawMock.mockReset()
  })

  it('should keep dashboard coverUrl as original relative media path', async () => {
    artistFindManyMock.mockResolvedValue([
      {
        id: 1,
        name: 'artist',
        username: 'artist',
        userId: '1000',
        bio: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        avatar: null,
        backgroundImg: null,
        isStarred: false,
        _count: {
          artworks: 3
        }
      }
    ])
    queryRawMock.mockResolvedValue([{ id: 11, artistId: 1 }])
    artworkFindManyMock.mockResolvedValue([
      {
        id: 11,
        title: 'cover',
        artistId: 1,
        images: [{ path: '1000/11_p0.jpg', mediaType: 'IMAGE', videoMetadata: null }]
      }
    ])

    const result = await getDashboardArtists({
      pageSize: 1,
      previewArtworkSize: 1
    })

    expect(artistFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: { gte: 1 }, artworks: { some: {} } },
        take: 1
      })
    )
    expect(queryRawMock).toHaveBeenCalledTimes(1)
    expect(artworkFindManyMock).toHaveBeenCalledTimes(1)
    expect(artworkFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: [11] }, deletedAt: null } })
    )
    expect(result[0]?.recentArtworks[0]?.coverUrl).toBe('1000/11_p0.jpg')
    expect(result[0]?.recentArtworks[0]?.coverMediaType).toBe('image')
  })

  it('uses a generated poster for dashboard video previews and returns null when it is missing', async () => {
    artistFindManyMock.mockResolvedValue([
      {
        id: 1,
        name: 'artist',
        username: 'artist',
        userId: '1000',
        bio: null,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        avatar: null,
        backgroundImg: null,
        isStarred: false,
        _count: { artworks: 2 }
      }
    ])
    queryRawMock.mockResolvedValue([
      { id: 11, artistId: 1 },
      { id: 12, artistId: 1 }
    ])
    artworkFindManyMock.mockResolvedValue([
      {
        id: 11,
        title: 'with poster',
        artistId: 1,
        images: [
          {
            path: '1000/video.mp4',
            mediaType: 'VIDEO',
            videoMetadata: {
              posterStatus: 'COMPLETED',
              posterPath: '11-cover.webp',
              posterUpdatedAt: new Date('2026-08-08T01:02:03.000Z')
            }
          }
        ]
      },
      {
        id: 12,
        title: 'without poster',
        artistId: 1,
        images: [{ path: '1000/video-2.mp4', mediaType: 'VIDEO', videoMetadata: null }]
      }
    ])

    const result = await getDashboardArtists({ pageSize: 1, previewArtworkSize: 2 })

    expect(result[0]?.recentArtworks).toEqual([
      expect.objectContaining({
        id: 11,
        coverUrl: '/_video-posters/11-cover.webp?v=1786150923000',
        coverMediaType: 'video'
      }),
      expect.objectContaining({ id: 12, coverUrl: null, coverMediaType: 'video' })
    ])
    expect(artworkFindManyMock).toHaveBeenCalledTimes(1)
  })
})

describe('updateArtist Pixiv identity safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    prismaTransactionMock.mockImplementation((operation) =>
      operation({
        artist: {
          findUniqueOrThrow: transactionArtistFindMock,
          update: transactionArtistUpdateMock
        },
        artistExternalRef: { deleteMany: vi.fn(), upsert: vi.fn() }
      })
    )
  })

  it('requires existing identity-bound images to be handled explicitly before changing the Pixiv id', async () => {
    transactionArtistFindMock.mockResolvedValue({
      avatar: 'avatar.jpg',
      backgroundImg: null,
      externalRefs: [{ externalId: '123' }]
    })

    await expect(updateArtist(1, { pixivUserId: '456' })).rejects.toThrow(
      '修改 Pixiv UserID 前请显式清空或重新填写现有头像'
    )
    expect(transactionArtistUpdateMock).not.toHaveBeenCalled()
  })
})
