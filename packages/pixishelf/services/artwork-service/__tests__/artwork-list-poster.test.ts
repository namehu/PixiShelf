import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'

const { queryRawMock, imageFindManyMock, artworkTagFindManyMock } = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  artworkTagFindManyMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: queryRawMock,
    image: { findMany: imageFindManyMock },
    artworkTag: { findMany: artworkTagFindManyMock }
  }
}))

import { getArtworksList } from '../index'

describe('getArtworksList video posters', () => {
  beforeEach(() => {
    queryRawMock.mockReset()
    imageFindManyMock.mockReset()
    artworkTagFindManyMock.mockReset()
  })

  it('loads video metadata and exposes the generated poster URL', async () => {
    const now = new Date('2026-08-08T01:02:03.000Z')
    queryRawMock.mockImplementation((query: string) => {
      if (query.includes('COUNT(*)')) return Promise.resolve([{ count: BigInt(1) }])
      return Promise.resolve([
        {
          id: 1,
          title: 'video work',
          imageCount: 1,
          artist_id: 2,
          artist_name: 'artist',
          sourceDate: now,
          createdAt: now,
          updatedAt: now
        }
      ])
    })
    imageFindManyMock.mockResolvedValue([
      {
        id: 10,
        path: '/artist/work/video.mp4',
        width: 1920,
        height: 1080,
        size: 2048,
        sortOrder: 0,
        artworkId: 1,
        createdAt: now,
        updatedAt: now,
        webpAnimationStatus: null,
        chaptersPath: null,
        chaptersCount: 0,
        chaptersDuration: null,
        chaptersUpdatedAt: null,
        chaptersHash: null,
        mediaType: 'VIDEO',
        videoMetadata: {
          posterStatus: 'COMPLETED',
          posterPath: '10-cover.webp',
          posterUpdatedAt: now
        }
      }
    ])
    artworkTagFindManyMock.mockResolvedValue([])

    const result = await getArtworksList(ArtworksInfiniteQuerySchema.parse({}))

    expect(imageFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ include: expect.objectContaining({ videoMetadata: true }) })
    )
    expect(result.items[0]?.images[0]).toMatchObject({
      path: '/artist/work/video.mp4',
      mediaType: 'video',
      posterUrl: '/_video-posters/10-cover.webp?v=1786150923000'
    })
  })
})
