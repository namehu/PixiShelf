import { describe, it, expect, vi } from 'vitest'
import { buildArtworkWhereClause } from '../query-builder'
import { ArtworksInfiniteQuerySchema } from '../../../schemas/artwork.dto'

// Mock server-only to avoid errors in test environment
vi.mock('server-only', () => ({}))

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
