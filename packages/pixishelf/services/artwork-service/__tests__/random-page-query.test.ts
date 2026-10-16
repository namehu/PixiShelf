import { describe, expect, it, vi } from 'vitest'
import { ArtworksInfiniteQuerySchema } from '@/schemas/artwork.dto'
vi.mock('@/lib/prisma', () => ({ prisma: {} }))
import { buildRandomRangeQuery, queryRandomArtworkIdsPage, randomPageContext } from '../random-page-query'
import { sanitizeBrowsePlan } from '../browse-diagnostics'

const params = ArtworksInfiniteQuerySchema.parse({
  sortBy: 'random',
  randomSeed: 0,
  pageSize: 2,
  readingStatus: 'UNREAD'
})
describe('indexed random ring', () => {
  it('overfetches across the wrap and continues from the last visible row, not the probe', async () => {
    const pivot = randomPageContext(params, 'a').pivot
    const raw = vi
      .fn()
      .mockResolvedValueOnce([{ id: 4, random_key: 'f'.repeat(32) }])
      .mockResolvedValueOnce([
        { id: 1, random_key: '0'.repeat(32) },
        { id: 2, random_key: '1'.repeat(32) }
      ])
    const result = await queryRandomArtworkIdsPage(params, 'a', { $queryRawUnsafe: raw })
    expect(result.ids).toEqual([4, 1])
    expect(raw.mock.calls[0]!.at(-1)).toBe(3)
    expect(raw.mock.calls[1]!.at(-1)).toBe(2)
    const state = randomPageContext({ ...params, randomCursor: result.nextRandomCursor }, 'a')
    expect(state.cursor).toMatchObject({ id: 1, phase: 1, pivot })
    raw.mockReset().mockResolvedValue([{ id: 2, random_key: '1'.repeat(32) }])
    const next = await queryRandomArtworkIdsPage({ ...params, randomCursor: result.nextRandomCursor }, 'a', {
      $queryRawUnsafe: raw
    })
    expect(raw).toHaveBeenCalledOnce()
    expect(next).toMatchObject({ ids: [2], hasNextPage: false, nextRandomCursor: undefined })
  })

  it('binds cursors to user, seed and normalized filters and rejects old cursors', async () => {
    const raw = vi.fn().mockResolvedValue([1, 2, 3].map((id) => ({ id, random_key: 'f'.repeat(32) })))
    const result = await queryRandomArtworkIdsPage(params, 'a', { $queryRawUnsafe: raw })
    for (const changed of [{ randomSeed: 1 }, { search: 'different' }, { readingStatus: 'COMPLETED' as const }]) {
      expect(() => randomPageContext({ ...params, ...changed, randomCursor: result.nextRandomCursor }, 'a')).toThrow(
        'ARTWORK_RANDOM_CURSOR_INVALID'
      )
    }
    expect(() => randomPageContext({ ...params, randomCursor: result.nextRandomCursor }, 'b')).toThrow()
    for (const changed of [{ cursor: 2 }, { readingCursor: 'old' }, { randomCursor: 'broken' }]) {
      expect(() => randomPageContext({ ...params, ...changed }, 'a')).toThrow('ARTWORK_RANDOM_CURSOR_INVALID')
    }
    expect(randomPageContext({ ...params, tagIds: [2, 1] }, 'a').context).toBe(
      randomPageContext({ ...params, tagIds: [1, 2] }, 'a').context
    )
    const query = buildRandomRangeQuery({ ...params, randomCursor: result.nextRandomCursor }, 'a', 0, 3)
    expect(query.sql).toContain('a.id) > (')
    expect(query.sql).toContain('NOT EXISTS')
    expect(query.sql).not.toMatch(/OFFSET|COUNT\(\*\)|LEFT JOIN/)
  })

  it('checks every selected tag without a full candidate aggregate', () => {
    const query = buildRandomRangeQuery({ ...params, tagIds: [3, 5] }, 'a', 0, 25)
    expect(query.sql.match(/FROM "ArtworkTag" at_required/g)).toHaveLength(2)
    expect(query.values.slice(0, 2)).toEqual([3, 5])
    expect(query.sql).not.toContain('GROUP BY')
  })

  it('requires a seed and account, and sanitizes diagnostic predicates', () => {
    expect(() => randomPageContext({ ...params, randomSeed: undefined }, 'a')).toThrow()
    expect(() => randomPageContext(params, '')).toThrow()
    expect(
      sanitizeBrowsePlan({
        Plan: { 'Node Type': 'Index Scan', Filter: 'private-user', 'Index Cond': 'private-search', 'Actual Rows': 24 }
      })
    ).toEqual({ Plan: { 'Node Type': 'Index Scan', 'Actual Rows': 24 } })
  })
})
