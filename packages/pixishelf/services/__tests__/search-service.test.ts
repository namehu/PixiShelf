import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tagFindManyMock, queryRawMock } = vi.hoisted(() => ({
  tagFindManyMock: vi.fn(),
  queryRawMock: vi.fn()
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    tag: { findMany: tagFindManyMock },
    $queryRawUnsafe: queryRawMock
  }
}))

import { getSearchSuggestions } from '../search-service'
import { searchSuggestionsSchema } from '@/schemas/search.dto'

describe('getSearchSuggestions', () => {
  beforeEach(() => {
    tagFindManyMock.mockReset()
    queryRawMock.mockReset()
  })

  it('reads tag suggestion counts from Tag.artworkCount', async () => {
    tagFindManyMock.mockResolvedValue([{ id: 7, name: 'landscape', artworkCount: 42 }])

    const result = await getSearchSuggestions({ q: 'land', mode: 'tag', limit: 8 })

    expect(tagFindManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { id: true, name: true, name_zh: true, name_en: true, artworkCount: true },
        orderBy: [{ artworkCount: 'desc' }, { name: 'asc' }, { id: 'asc' }],
        take: 8
      })
    )
    expect(result).toEqual({
      suggestions: [
        {
          type: 'tag',
          value: 'landscape',
          label: '#landscape',
          metadata: { id: 7, artworkCount: 42 }
        }
      ]
    })
  })

  it.each(['ねこ', '猫咪', '猫', 'Cat', 'cAT'])('matches all tag names case-insensitively for %s', async (query) => {
    tagFindManyMock.mockResolvedValue([{ id: 17, name: 'ねこ', name_zh: '猫咪', name_en: 'Cat', artworkCount: 6 }])

    const result = await getSearchSuggestions({ q: `  ${query}  `, mode: 'tag', limit: 3 })

    expect(tagFindManyMock).toHaveBeenCalledWith({
      where: {
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { name_zh: { contains: query, mode: 'insensitive' } },
          { name_en: { contains: query, mode: 'insensitive' } }
        ]
      },
      select: { id: true, name: true, name_zh: true, name_en: true, artworkCount: true },
      orderBy: [{ artworkCount: 'desc' }, { name: 'asc' }, { id: 'asc' }],
      take: 3
    })
    expect(result.suggestions).toEqual([
      { type: 'tag', value: 'ねこ', label: '#ねこ · 猫咪 · Cat', metadata: { id: 17, artworkCount: 6 } }
    ])
    expect(queryRawMock).not.toHaveBeenCalled()
  })

  it('uses one row query for overlapping names and preserves distinct IDs with the same name', async () => {
    tagFindManyMock.mockResolvedValue([
      { id: 17, name: 'cat', name_zh: '猫', name_en: 'cat', artworkCount: 6 },
      { id: 18, name: 'cat', name_zh: null, name_en: null, artworkCount: 6 }
    ])

    const result = await getSearchSuggestions({ q: 'cat', mode: 'tag', limit: 8 })

    expect(tagFindManyMock).toHaveBeenCalledTimes(1)
    expect(result.suggestions).toEqual([
      { type: 'tag', value: 'cat', label: '#cat · 猫', metadata: { id: 17, artworkCount: 6 } },
      { type: 'tag', value: 'cat', label: '#cat', metadata: { id: 18, artworkCount: 6 } }
    ])
  })

  it('returns no suggestions when none of the names match', async () => {
    tagFindManyMock.mockResolvedValue([])

    await expect(getSearchSuggestions({ q: '不存在', mode: 'tag', limit: 8 })).resolves.toEqual({ suggestions: [] })
  })

  it.each(['normal', 'tag'] as const)('does not query empty or whitespace-only input in %s mode', async (mode) => {
    for (const q of ['', ' ', '\t\n']) {
      await expect(getSearchSuggestions({ q, mode, limit: 8 })).resolves.toEqual({ suggestions: [] })
    }
    expect(tagFindManyMock).not.toHaveBeenCalled()
    expect(queryRawMock).not.toHaveBeenCalled()
  })

  it('uses Artwork.imageCount without joining or grouping Image rows', async () => {
    queryRawMock
      .mockResolvedValueOnce([{ id: 3, name: 'artist', username: null, artwork_count: BigInt(2) }])
      .mockResolvedValueOnce([{ title: 'cat animation', artist_name: 'artist', image_count: 9 }])

    const result = await getSearchSuggestions({ q: 'cat', mode: 'normal', limit: 8 })

    const artworkQueryCall = queryRawMock.mock.calls[1]
    const artworkQuery = String(artworkQueryCall?.[0])
    expect(artworkQuery).toContain('aw."imageCount" as image_count')
    expect(artworkQuery).toContain('ORDER BY aw."imageCount" DESC')
    expect(artworkQuery).not.toContain('JOIN "Image"')
    expect(artworkQuery).not.toContain('COUNT(i.id)')
    expect(artworkQuery).not.toContain('GROUP BY')
    expect(artworkQueryCall?.slice(1)).toEqual(['%cat%', 7])
    expect(tagFindManyMock).not.toHaveBeenCalled()
    expect(result.suggestions).toEqual([
      {
        type: 'artist',
        value: 'artist',
        label: 'artist',
        metadata: { id: 3, imageCount: 2 }
      },
      {
        type: 'artwork',
        value: 'cat animation',
        label: 'cat animation',
        metadata: { artistName: 'artist', imageCount: 9 }
      }
    ])
  })

  it('does not query the database for a one-character search', async () => {
    await expect(getSearchSuggestions({ q: 'a', mode: 'normal', limit: 8 })).resolves.toEqual({ suggestions: [] })
    expect(tagFindManyMock).not.toHaveBeenCalled()
    expect(queryRawMock).not.toHaveBeenCalled()
  })

  it('also enforces the limit when called directly as a server function', async () => {
    await expect(getSearchSuggestions({ q: 'cat', mode: 'tag', limit: 11 })).rejects.toThrow()
    expect(tagFindManyMock).not.toHaveBeenCalled()
    expect(queryRawMock).not.toHaveBeenCalled()
  })
})

describe('search suggestion input', () => {
  it('normalizes input and keeps the default response bounded', () => {
    expect(searchSuggestionsSchema.parse({ q: '  猫  ' })).toEqual({ q: '猫', mode: 'normal', limit: 8 })
  })

  it.each([0, 1.5, 11])('rejects an invalid result limit of %s', (limit) => {
    expect(searchSuggestionsSchema.safeParse({ q: 'cat', limit }).success).toBe(false)
  })
})
