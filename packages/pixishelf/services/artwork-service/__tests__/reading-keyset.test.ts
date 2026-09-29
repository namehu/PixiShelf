import { describe, expect, it, vi } from 'vitest'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'

vi.mock('server-only', () => ({}))

import { appendReadingFilterAndCursor, encodeReadingCursor } from '../reading-keyset'

function build(input: Record<string, unknown>) {
  const params = ArtworksInfiniteQuerySchema.parse({ readingStatus: 'IN_PROGRESS', ...input })
  return { params, query: appendReadingFilterAndCursor(params, 'user-1', { whereSQL: 'WHERE TRUE', sqlParams: [], paramIndex: 1 }) }
}

describe('reading keyset query', () => {
  it.each([
    ['title_asc', 'title', 'a.title >'],
    ['title_desc', 'title', 'a.title <'],
    ['images_asc', 12, 'a."imageCount" >'],
    ['images_desc', 12, 'a."imageCount" <'],
    ['source_date_asc', '2026-01-01T00:00:00.000Z', 'COALESCE(a."sourceDate", a."createdAt") >'],
    ['source_date_desc', '2026-01-01T00:00:00.000Z', 'COALESCE(a."sourceDate", a."createdAt") <'],
    ['created_at_asc', '2026-01-01T00:00:00.000Z', 'a."createdAt" >'],
    ['created_at_desc', '2026-01-01T00:00:00.000Z', 'a."createdAt" <']
  ] as const)('continues %s from the stored value and ID', (sortBy, reading_sort_value, predicate) => {
    const { params } = build({ sortBy })
    const readingCursor = encodeReadingCursor(params, 'user-1', { id: 42, reading_sort_value })
    const next = build({ sortBy, readingCursor })
    expect(next.query.whereSQL).toContain(predicate)
    expect(next.query.sqlParams.slice(-2)).toEqual([reading_sort_value, 42])
    expect(next.query.whereSQL).not.toContain('SELECT reading_sort_value FROM')
  })

  it('keeps NULLS LAST ordering for creator names in both directions', () => {
    for (const sortBy of ['artist_asc', 'artist_desc']) {
      const { params } = build({ sortBy })
      const next = build({ sortBy, readingCursor: encodeReadingCursor(params, 'user-1', { id: 77, reading_sort_value: null }) })
      expect(next.query.whereSQL).toContain('IS NULL AND a.id')
      expect(next.query.orderBySQL).toContain('NULLS LAST')
      expect(next.query.sqlParams.at(-1)).toBe(77)
    }
  })

  it('uses the same seeded random value and rejects a changed filter', () => {
    const { params } = build({ sortBy: 'random', randomSeed: 12 })
    const readingCursor = encodeReadingCursor(params, 'user-1', { id: 5, reading_sort_value: 'abcdef' })
    const next = build({ sortBy: 'random', randomSeed: 12, readingCursor })
    expect(next.query.sortValueSQL).toContain('md5(a.id::text')
    expect(next.query.sqlParams).toEqual(['user-1', '12', 'abcdef', 5])
    expect(() => build({ sortBy: 'random', randomSeed: 13, readingCursor })).toThrow('Invalid reading cursor')
    expect(() => appendReadingFilterAndCursor(ArtworksInfiniteQuerySchema.parse({ readingStatus: 'IN_PROGRESS', sortBy: 'random', randomSeed: 12, readingCursor }), 'user-2', { whereSQL: 'WHERE TRUE', sqlParams: [], paramIndex: 1 })).toThrow('Invalid reading cursor')
    expect(() => build({ sortBy: 'random' })).toThrow('randomSeed')
  })
})
