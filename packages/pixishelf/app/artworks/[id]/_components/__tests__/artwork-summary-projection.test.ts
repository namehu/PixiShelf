import { describe, expect, it } from 'vitest'
import { groupSummaryMedia } from '@pixishelf/job-contracts'
import { projectArtworkSummary } from '../artwork-summary-projection'
const f = { hash: '0000000000000000', colors: Array(192).fill(100), aspect: 1 }
const groups = groupSummaryMedia([1, 2, 3, 4, 5].map((mediaId) => ({ mediaId, feature: mediaId === 4 ? null : f })))
describe('summary projection', () => {
  it('uses first remaining unread member and retains original group membership', () => {
    const result = projectArtworkSummary([{ id: 2 }, { id: 3 }, { id: 5 }], groups, new Set())
    expect(result.images.map((image) => image.id)).toEqual([2, 5])
    expect(result.decorations.get(2)).toMatchObject({ representativeId: 2, visibleCount: 2, group: { mediaIds: [1, 2, 3] } })
  })
  it('expands only selected groups in original order, without hidden image slots', () => {
    const images = [1, 2, 3, 4, 5].map((id) => ({ id }))
    expect(projectArtworkSummary(images, groups, new Set()).images.map((image) => image.id)).toEqual([1, 4, 5])
    expect(projectArtworkSummary(images, groups, new Set(['1'])).images).toEqual(images)
  })
})
