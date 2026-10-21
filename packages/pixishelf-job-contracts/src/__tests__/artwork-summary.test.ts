import { describe, expect, it } from 'vitest'
import { groupSummaryMedia, similarSummaryFeatures, type SummaryFeature } from '../artwork-summary.ts'
const feature = (value = 100): SummaryFeature => ({ hash: '0000000000000000', colors: Array(192).fill(value), aspect: 1 })
describe('adjacent visual summary', () => {
  it('keeps source order and never merges non-adjacent repeats', () => {
    const groups = groupSummaryMedia([100, 100, 200, 100, 100].map((value, index) => ({ mediaId: index + 1, feature: feature(value) })))
    expect(groups.map((group) => group.mediaIds)).toEqual([[1, 2], [3], [4, 5]])
    expect(groups[2]).toMatchObject({ representativeMediaId: 4, startIndex: 3, endIndex: 4 })
  })
  it('bounds accumulated drift against the first image, not only neighbors', () => {
    const groups = groupSummaryMedia([100, 107, 114, 121].map((value, index) => ({ mediaId: index + 1, feature: feature(value) })))
    expect(groups.map((group) => group.mediaIds)).toEqual([[1, 2], [3, 4]])
  })
  it('preserves local changes, aspect changes and unsupported media as boundaries', () => {
    const changed = feature(); changed.colors.splice(0, 3, 180, 180, 180)
    expect(similarSummaryFeatures(feature(), changed)).toBe(false)
    expect(similarSummaryFeatures(feature(), { ...feature(), aspect: 1.03 })).toBe(false)
    expect(groupSummaryMedia([feature(), null, feature()].map((value, index) => ({ mediaId: index + 1, feature: value }))).map((group) => group.mediaIds)).toEqual([[1], [2], [3]])
  })
})
