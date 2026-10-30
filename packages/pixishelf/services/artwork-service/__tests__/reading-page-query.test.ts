import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'

const queryRawMock = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({ prisma: { $queryRawUnsafe: queryRawMock } }))

import { queryReadingArtworkIdsPage, queryReadingArtworkRowsPage } from '../reading-page-query'
import { buildArtworkWhereClause } from '../query-builder'

describe('reading page SQL', () => {
  beforeEach(() => {
    queryRawMock.mockReset()
  })

  it('combines favorites with ordinary filters and rejects cursors from another account or collection', async () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      likedOnly: true,
      pageSize: 1,
      sortBy: 'title_asc',
      search: 'cat',
      tagIds: [1, 2],
      sources: ['LOCAL_IMPORT']
    })
    expect(() => buildArtworkWhereClause(params)).toThrow('Authenticated user required')
    queryRawMock.mockResolvedValue([
      { id: 1, reading_sort_value: 'A' },
      { id: 2, reading_sort_value: 'B' }
    ])
    const first = await queryReadingArtworkIdsPage(params, 'alice')
    const [sql, ...values] = queryRawMock.mock.calls[0]!
    expect(sql).toContain('FROM "ArtworkLike"')
    expect(sql).toContain('al."userId" = $1')
    expect(sql).toContain('al."level" = ANY(')
    expect(sql).toContain('a.title ILIKE')
    expect(sql).toContain('GROUP BY')
    expect(sql).not.toMatch(/artwork_reading_summaries|OFFSET/)
    expect(values).toContain('alice')
    queryRawMock.mockReset().mockResolvedValue([{ id: 2, reading_sort_value: 'B' }])
    await queryReadingArtworkIdsPage({ ...params, readingCursor: first.nextReadingCursor }, 'alice')
    expect(queryRawMock.mock.calls[0]?.[0]).toContain('a.title >')
    await expect(
      queryReadingArtworkIdsPage({ ...params, readingCursor: first.nextReadingCursor }, 'bob')
    ).rejects.toThrow('Invalid reading cursor')
    await expect(
      queryReadingArtworkIdsPage({ ...params, likedOnly: false, readingCursor: first.nextReadingCursor }, 'alice')
    ).rejects.toThrow('Invalid reading cursor')
    expect(buildArtworkWhereClause(ArtworksInfiniteQuerySchema.parse({ likedOnly: false })).whereSQL).not.toContain(
      'ArtworkLike'
    )
    expect(() =>
      buildArtworkWhereClause({ ...params, likedOnly: false, readingCursor: first.nextReadingCursor })
    ).toThrow('Invalid reading cursor')
  })

  it('filters by authenticated account, overfetches IDs and uses no offset', async () => {
    queryRawMock.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('COUNT(*)')
          ? [{ count: 3n }]
          : [
              { id: 1, reading_sort_value: 10 },
              { id: 2, reading_sort_value: 9 },
              { id: 3, reading_sort_value: 8 }
            ]
      )
    )
    const params = ArtworksInfiniteQuerySchema.parse({
      readingStatus: 'IN_PROGRESS',
      sortBy: 'images_desc',
      pageSize: 2,
      search: 'cat'
    })
    const first = await queryReadingArtworkIdsPage(params, 'user-1')
    expect(first).toMatchObject({ ids: [1, 2], hasNextPage: true })
    expect(first).not.toHaveProperty('total')
    expect(queryRawMock).toHaveBeenCalledOnce()
    expect(String(queryRawMock.mock.calls[0]?.[0])).not.toContain('COUNT(*)')
    const firstSQL = queryRawMock.mock.calls.find(([sql]) => String(sql).includes('SELECT a.id'))!
    expect(String(firstSQL[0])).toContain('artwork_reading_summaries')
    expect(String(firstSQL[0])).toContain('a.title ILIKE')
    expect(String(firstSQL[0])).not.toContain('OFFSET')
    expect(firstSQL).toContain('user-1')

    queryRawMock.mockReset().mockResolvedValue([{ id: 3, reading_sort_value: 8 }])
    const second = await queryReadingArtworkIdsPage({ ...params, readingCursor: first.nextReadingCursor }, 'user-1')
    expect(second.ids).toEqual([3])
    expect(queryRawMock).toHaveBeenCalledOnce()
    expect(String(queryRawMock.mock.calls[0]?.[0])).toContain('a."imageCount" <')
    expect(queryRawMock.mock.calls[0]).toContain(9)
    expect(queryRawMock.mock.calls[0]).toContain(2)
  })

  it('returns full artwork columns and creator metadata for feed hydration', async () => {
    queryRawMock.mockResolvedValue([{ id: 1, reading_sort_value: 'A', artist_id: 7 }])
    const params = ArtworksInfiniteQuerySchema.parse({ readingStatus: 'UNREAD', sortBy: 'artist_asc' })
    const page = await queryReadingArtworkRowsPage(params, 'user-1')
    expect(page.rows[0]).toMatchObject({ id: 1, artist_id: 7 })
    expect(String(queryRawMock.mock.calls[0]?.[0])).toContain('artist.id as artist_id')
    expect(String(queryRawMock.mock.calls[0]?.[0])).toContain('NULLS LAST')
  })
})
