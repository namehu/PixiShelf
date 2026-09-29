import { beforeEach, describe, expect, it } from 'vitest'
import {
  ARTWORK_DETAIL_STORAGE_KEY,
  getArtworkDisplayPolicy,
  normalizePreviewCount,
  useArtworkDetailPreferences
} from '../use-artwork-detail-preferences'

describe('artwork detail preferences', () => {
  beforeEach(() => localStorage.clear())

  it.each([
    [1, 1, false],
    [1, 2, true],
    [10, 12, false],
    [10, 13, true],
    [20, 24, false],
    [20, 25, false],
    [20, 26, true],
    [100, 125, false],
    [100, 126, true]
  ])('applies uncapped rounded-down tolerance for N=%i and total=%i', (limit, total, collapsible) => {
    expect(getArtworkDisplayPolicy(total as number, limit as number, false).collapsible).toBe(collapsible)
    expect(getArtworkDisplayPolicy(total as number, limit as number, true).visibleCount).toBe(total)
  })

  it('handles empty collections and normalizes numeric and invalid saved values', () => {
    expect(getArtworkDisplayPolicy(0, 10, false).visibleCount).toBe(0)
    expect([0, 101, 2.6, NaN, '20', null].map(normalizePreviewCount)).toEqual([1, 100, 3, 10, 10, 10])
  })

  it('persists only the preference and never hydrates foreign actions or session state', async () => {
    useArtworkDetailPreferences.getState().setPreviewCount(42)
    expect(JSON.parse(localStorage.getItem(ARTWORK_DETAIL_STORAGE_KEY)!).state).toEqual({ previewCount: 42 })
    localStorage.setItem(
      ARTWORK_DETAIL_STORAGE_KEY,
      JSON.stringify({ state: { previewCount: 20, expanded: true, setPreviewCount: null }, version: 0 })
    )
    await useArtworkDetailPreferences.persist.rehydrate()
    expect(useArtworkDetailPreferences.getState().previewCount).toBe(20)
    expect(typeof useArtworkDetailPreferences.getState().setPreviewCount).toBe('function')
    expect(useArtworkDetailPreferences.getState()).not.toHaveProperty('expanded')
  })
})
