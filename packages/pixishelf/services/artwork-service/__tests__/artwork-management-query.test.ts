import { describe, it, expect, vi } from 'vitest'
import { getArtworksList } from '..'
import { buildArtworkWhereClause } from '../query-builder'
import { ArtworksInfiniteQuerySchema } from '../../../schemas/artwork.dto'

// Mock server-only to avoid errors in test environment
vi.mock('server-only', () => ({}))
vi.mock('@/lib/prisma', () => ({
  prisma: {
    $queryRawUnsafe: vi.fn().mockImplementation((query: string) => {
      if (query.includes('COUNT(*)')) {
        return Promise.resolve([{ count: BigInt(0) }])
      }

      return Promise.resolve([])
    })
  }
}))

describe('buildArtworkWhereClause', () => {
  it('should build basic query without tags', () => {
    const params = ArtworksInfiniteQuerySchema.parse({})
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toBe('WHERE 1=1')
    expect(sqlParams).toHaveLength(0)
  })

  it('should build query with included tags', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      tags: 'tag1,tag2'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('AND EXISTS')
    expect(whereSQL).toContain('t2.name = ANY($1)')
    expect(sqlParams[0]).toEqual(['tag1', 'tag2'])
  })

  it('should build query with excluded tags', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      excludeTags: 'bad1,bad2'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('AND NOT EXISTS')
    expect(whereSQL).toContain('t_ex.name = ANY($1)')
    expect(sqlParams[0]).toEqual(['bad1', 'bad2'])
  })

  it('should build query with included tag ids requiring all selected tags', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      tagIds: '1,2'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('COUNT(DISTINCT at_ids."tagId")')
    expect(whereSQL).toContain('at_ids."tagId" = ANY($1::int[])')
    expect(whereSQL).toContain('cardinality($1::int[])')
    expect(sqlParams[0]).toEqual([1, 2])
  })

  it('should build query with artist, tag ids, search, and media type in stable param order', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      artistId: 9,
      tagIds: [1, 2],
      search: 'miku',
      mediaType: 'video'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('a."artistId" = $1')
    expect(whereSQL).toContain('at_ids."tagId" = ANY($2::int[])')
    expect(whereSQL).toContain('cardinality($2::int[])')
    expect(whereSQL).toContain('a.title ILIKE $3')
    expect(whereSQL).toContain('LOWER(i.path) LIKE $4')
    expect(sqlParams[0]).toBe(9)
    expect(sqlParams[1]).toEqual([1, 2])
    expect(sqlParams[2]).toBe('%miku%')
  })

  it('should match artist name or pixiv user id from the artist filter', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      artistName: '123456'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('(artist.name ILIKE $1 OR artist."userId" ILIKE $1)')
    expect(sqlParams).toEqual(['%123456%'])
  })

  it('should build query with selected media extensions', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      mediaTypes: '.webp,.mp4'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('EXISTS')
    expect(whereSQL).toContain('LOWER(i.path) LIKE $1 OR LOWER(i.path) LIKE $2')
    expect(sqlParams).toEqual(['%.webp', '%.mp4'])
  })

  it('should ignore empty tag ids', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      tagIds: ''
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toBe('WHERE 1=1')
    expect(sqlParams).toHaveLength(0)
  })

  it('should build query with database created date range', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      createdStartDate: '2026-01-01',
      createdEndDate: '2026-01-31'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('a."createdAt" >= $1::date')
    expect(whereSQL).toContain('a."createdAt" < ($2::date + 1)')
    expect(sqlParams).toEqual(['2026-01-01', '2026-01-31'])
  })

  it('should keep source date and database created date filters independent', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      startDate: '2025-12-01',
      endDate: '2025-12-31',
      createdStartDate: '2026-01-01',
      createdEndDate: '2026-01-31'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('a."sourceDate" >= $1::date')
    expect(whereSQL).toContain('a."sourceDate" < ($2::date + 1)')
    expect(whereSQL).toContain('a."createdAt" >= $3::date')
    expect(whereSQL).toContain('a."createdAt" < ($4::date + 1)')
    expect(sqlParams).toEqual(['2025-12-01', '2025-12-31', '2026-01-01', '2026-01-31'])
  })

  it('should build query with both included and excluded tags', () => {
    const params = ArtworksInfiniteQuerySchema.parse({
      tags: 'good1',
      excludeTags: 'bad1'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('AND EXISTS')
    expect(whereSQL).toContain('AND NOT EXISTS')

    // Check param order
    // Included tags first ($1), then Excluded tags ($2) based on implementation order
    expect(whereSQL).toContain('t2.name = ANY($1)')
    expect(whereSQL).toContain('t_ex.name = ANY($2)')

    expect(sqlParams[0]).toEqual(['good1'])
    expect(sqlParams[1]).toEqual(['bad1'])
  })

  it('should handle empty arrays gracefully', () => {
    // Schema transform handles empty string -> empty array
    const params = ArtworksInfiniteQuerySchema.parse({
      tags: '',
      excludeTags: ''
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toBe('WHERE 1=1')
    expect(sqlParams).toHaveLength(0)
  })

  it('should prioritize excludeTags over tags logic conflict if any (logic is AND)', () => {
    // The current logic is AND: must have included AND must not have excluded.
    // If a tag is in both, result is empty set (correct behavior).
    const params = ArtworksInfiniteQuerySchema.parse({
      tags: 'common',
      excludeTags: 'common'
    })
    const { whereSQL, sqlParams } = buildArtworkWhereClause(params)

    expect(whereSQL).toContain('AND EXISTS')
    expect(whereSQL).toContain('AND NOT EXISTS')
    expect(sqlParams[0]).toEqual(['common'])
    expect(sqlParams[1]).toEqual(['common'])
  })
})

describe('getArtworksList sort mapping', () => {
  it('should sort by database created time descending', async () => {
    const { prisma } = await import('@/lib/prisma')

    await getArtworksList(
      ArtworksInfiniteQuerySchema.parse({
        sortBy: 'created_at_desc'
      })
    )

    const listQuery = vi.mocked(prisma.$queryRawUnsafe).mock.calls.find(([query]) =>
      String(query).includes('FROM "Artwork" a') && String(query).includes('LIMIT')
    )?.[0]

    expect(String(listQuery)).toContain('ORDER BY a."createdAt" DESC')
  })
})
