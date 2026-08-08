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
        select: { id: true, name: true, artworkCount: true },
        orderBy: [{ artworkCount: 'desc' }, { name: 'asc' }]
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
})
