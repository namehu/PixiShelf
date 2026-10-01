import { describe, expect, it } from 'vitest'
import { changeDraft, undoDraft, redoDraft, moveDraft, naturalDraftOrder, sameOrder } from '../series-draft'
import { naturalSeriesOrder, type SeriesArtworkRow } from '@/schemas/series-management'

describe('series draft', () => {
  it('undoes and redoes membership and order changes with a bounded history', () => {
    let state = { ids: [1, 2], past: [] as number[][], future: [] as number[][] }
    state = changeDraft(state, [2, 1, 3])
    expect(undoDraft(state).ids).toEqual([1, 2])
    expect(redoDraft(undoDraft(state)).ids).toEqual([2, 1, 3])
    for (let i = 4; i < 100; i++) state = changeDraft(state, [i])
    expect(state.past).toHaveLength(50)
    expect(changeDraft(undoDraft(state), [999]).future).toEqual([])
  })
  it('moves using one-based absolute positions and rejects invalid positions', () => {
    expect(moveDraft([1, 2, 3, 4], 4, 1)).toEqual([4, 1, 2, 3])
    expect(moveDraft([1, 2, 3, 4], 1, 4)).toEqual([2, 3, 4, 1])
    expect(moveDraft([1, 2], 1, 0)).toEqual([1, 2])
    expect(moveDraft([1, 2], 1, 1.5)).toEqual([1, 2])
  })
  it('restores historical positions with stable tie-breaking and detects effective reorder', () => {
    const stored = [
      { artworkId: 3, sortOrder: 10 },
      { artworkId: 1, sortOrder: 5 },
      { artworkId: 2, sortOrder: 5 }
    ]
    expect(naturalSeriesOrder([3, 2, 1, 4], stored, 20)).toEqual([1, 2, 3, 4])
    const rows = new Map(
      stored.map((r) => [r.artworkId, { id: r.artworkId, sortOrder: r.sortOrder } as SeriesArtworkRow])
    )
    const initial = { ids: [1, 2, 3], past: [] as number[][], future: [] as number[][] }
    const reordered = changeDraft(initial, [3, 1, 2])
    expect(sameOrder(reordered.ids, naturalDraftOrder(reordered.ids, rows))).toBe(false)
    const undone = undoDraft(reordered)
    expect(sameOrder(undone.ids, naturalDraftOrder(undone.ids, rows))).toBe(true)
  })
})
