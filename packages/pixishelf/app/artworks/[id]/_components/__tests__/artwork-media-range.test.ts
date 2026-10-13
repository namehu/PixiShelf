import { describe, expect, it } from 'vitest'
import { getArtworkMediaRange } from '../artwork-media-range'

const range = { startIndex: 5, endIndex: 7, count: 100, overscan: 2 }

describe('reading preload range', () => {
  it('keeps two items behind and two screens ahead, including the boundary item', () => {
    const sizes = [300, 500, 900, 800]
    expect(getArtworkMediaRange(range, 800, (index) => sizes[index - 8] ?? 800))
      .toEqual([3, 4, 5, 6, 7, 8, 9, 10])
  })

  it('caps short-image preloading at twelve without excluding visible items', () => {
    expect(getArtworkMediaRange(range, 800, () => 1)).toEqual(Array.from({ length: 17 }, (_, i) => i + 3))
  })

  it('stays inside the expanded or collapsed item count and handles a single long image', () => {
    expect(getArtworkMediaRange({ ...range, startIndex: 0, endIndex: 0, count: 1 }, 800, () => 5000)).toEqual([0])
    expect(getArtworkMediaRange({ ...range, count: 9 }, 800, () => 50)).toEqual([3, 4, 5, 6, 7, 8])
    expect(getArtworkMediaRange(range, 800, () => 5000)).toEqual([3, 4, 5, 6, 7, 8])
  })

  it('adapts to viewport and measured height changes', () => {
    expect(getArtworkMediaRange(range, 400, () => 400)).toHaveLength(7)
    expect(getArtworkMediaRange(range, 800, () => 400)).toHaveLength(9)
    expect(getArtworkMediaRange(range, 800, () => 200)).toHaveLength(13)
  })
})
