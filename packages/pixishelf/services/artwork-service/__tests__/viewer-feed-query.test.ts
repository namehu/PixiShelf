import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ViewerFeedQuerySchema } from '@/schemas/artwork.dto'
import { ESource } from '@/enums/e-source'

const {
  queryRawMock,
  imageFindManyMock,
  artworkTagFindManyMock,
  artistExternalRefFindManyMock,
  localArtistMappingFindManyMock,
  artworkExternalRefFindManyMock,
  likeStatusMock
} = vi.hoisted(() => ({
  queryRawMock: vi.fn(),
  imageFindManyMock: vi.fn(),
  artworkTagFindManyMock: vi.fn(),
  artistExternalRefFindManyMock: vi.fn(),
  localArtistMappingFindManyMock: vi.fn(),
  artworkExternalRefFindManyMock: vi.fn(),
  likeStatusMock: vi.fn()
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: queryRawMock,
    image: { findMany: imageFindManyMock },
    artworkTag: { findMany: artworkTagFindManyMock },
    artistExternalRef: { findMany: artistExternalRefFindManyMock },
    localImportArtistMapping: { findMany: localArtistMappingFindManyMock },
    artworkExternalRef: { findMany: artworkExternalRefFindManyMock }
  }
}))
vi.mock('@/services/like-service', () => ({ getUserArtworkLikeStatus: likeStatusMock }))

import { getViewerFeed } from '../index'

function rawArtwork(id: number) {
  const date = new Date('2026-08-12T00:00:00.000Z')
  return {
    id,
    title: `artwork ${id}`,
    description: '',
    imageCount: 1,
    createdAt: date,
    updatedAt: date,
    sourceDate: date,
    artist_id: null
  }
}

describe('getViewerFeed query shape', () => {
  beforeEach(() => {
    queryRawMock.mockReset()
    imageFindManyMock.mockReset().mockResolvedValue([])
    artworkTagFindManyMock.mockReset().mockResolvedValue([])
    artistExternalRefFindManyMock.mockReset().mockResolvedValue([])
    localArtistMappingFindManyMock.mockReset().mockResolvedValue([])
    artworkExternalRefFindManyMock.mockReset().mockResolvedValue([])
    likeStatusMock.mockReset().mockResolvedValue({})
  })

  it('uses one overfetched page query, forwards all filters, and skips an exact count', async () => {
    queryRawMock.mockResolvedValue([rawArtwork(1), rawArtwork(2), rawArtwork(3)])
    const input = ViewerFeedQuerySchema.parse({
      pageSize: 2,
      mode: 'ordered',
      sortBy: 'created_at_desc',
      artistId: 9,
      tagIds: [1, 2],
      sources: [ESource.PIXIV_IMPORTED],
      hasAudio: 'yes',
      mediaType: 'video',
      startDate: '2025-01-01',
      endDate: '2025-12-31',
      createdStartDate: '2026-01-01',
      createdEndDate: '2026-08-12'
    })

    const result = await getViewerFeed({ ...input, userId: 'user-1' })

    expect(queryRawMock).toHaveBeenCalledOnce()
    const [sql, ...params] = queryRawMock.mock.calls[0]!
    expect(String(sql)).not.toContain('COUNT(*)')
    expect(String(sql)).toContain('GROUP BY at_ids."artworkId"')
    expect(String(sql)).toContain('a.source = ANY')
    expect(String(sql)).toContain('a."createdAt" >=')
    expect(params.slice(-2)).toEqual([3, 0])
    expect(imageFindManyMock).toHaveBeenCalledOnce()
    expect(artworkTagFindManyMock).toHaveBeenCalledOnce()
    expect(artworkExternalRefFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { artworkId: { in: [1, 2] } } })
    )
    expect(likeStatusMock).toHaveBeenCalledWith('user-1', [1, 2])
    expect(result).toMatchObject({ page: 1, pageSize: 2, nextPage: 2 })
    expect(result.items).toHaveLength(2)
    expect(result).not.toHaveProperty('total')
  })

  it('uses legacy tag context only when explicit tag ids are absent', async () => {
    queryRawMock.mockResolvedValue([rawArtwork(4)])

    await getViewerFeed({
      ...ViewerFeedQuerySchema.parse({ source: 'tag', sourceId: 12, mode: 'ordered', pageSize: 2 }),
      userId: 'user-1'
    })

    expect(queryRawMock).toHaveBeenCalledOnce()
    expect(queryRawMock.mock.calls[0]).toContainEqual([12])
  })
})
