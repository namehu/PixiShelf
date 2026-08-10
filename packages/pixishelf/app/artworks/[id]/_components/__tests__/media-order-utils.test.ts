import { describe, expect, it } from 'vitest'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import {
  countNaturalOrderMismatches,
  getNaturalOrderRanks,
  haveSameMediaOrder,
  moveMediaItem,
  sortMediaNaturally,
  swapMediaItems
} from '../media-order-utils'

function media(id: number, path: string): ArtworkImageResponseDto {
  return {
    id,
    path,
    width: 1200,
    height: 1800,
    size: null,
    sortOrder: id - 1,
    artworkId: 1,
    createdAt: '2026-01-01 00:00:00',
    updatedAt: '2026-01-01 00:00:00',
    webpAnimationStatus: null,
    chaptersPath: null,
    chaptersCount: 0,
    chaptersDuration: null,
    chaptersUpdatedAt: null,
    chaptersHash: null,
    mediaType: 'image',
    hasChapters: false,
    chaptersUrl: null
  }
}

describe('media order utilities', () => {
  const page1 = media(1, '/work/page-1.jpg')
  const page2 = media(2, '/work/page-2.jpg')
  const page10 = media(3, '/work/page-10.jpg')

  it('uses the existing natural filename comparison and reports displaced positions', () => {
    const current = [page10, page1, page2]

    expect(sortMediaNaturally(current).map((item) => item.id)).toEqual([1, 2, 3])
    expect([...getNaturalOrderRanks(current).entries()]).toEqual([
      [1, 0],
      [2, 1],
      [3, 2]
    ])
    expect(countNaturalOrderMismatches(current)).toBe(3)
  })

  it('moves and swaps media without mutating the source array', () => {
    const source = [page1, page2, page10]

    expect(moveMediaItem(source, 0, 2).map((item) => item.id)).toEqual([2, 3, 1])
    expect(swapMediaItems(source, 0, 1).map((item) => item.id)).toEqual([2, 1, 3])
    expect(source.map((item) => item.id)).toEqual([1, 2, 3])
  })

  it('compares order by media identity', () => {
    expect(haveSameMediaOrder([page1, page2], [page1, page2])).toBe(true)
    expect(haveSameMediaOrder([page1, page2], [page2, page1])).toBe(false)
  })
})
