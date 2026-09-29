import { describe, expect, it } from 'vitest'
import { creatorReviewSummary } from '../creator-review-summary'

const source = {
  creatorNames: [],
  evidence: [],
  refs: [{ tags: [{ namespace: 'artist', name: 'chaesu' }], remapped: [] }]
}

describe('creator review summaries from stored checks', () => {
  it('shows an empty author changing to the website author without boilerplate', () => {
    expect(creatorReviewSummary('BACKFILL', source)).toEqual({
      label: '作者',
      before: '未填写',
      after: 'chaesu',
      basis: '原网站的作者标签',
      note: null
    })
  })
  it('does not promise to restore a manually excluded website author', () => {
    const summary = creatorReviewSummary('BACKFILL', {
      ...source,
      evidence: [{ artistId: 1, evidence: [{ excludedAt: '2026-09-09' }] }]
    })
    expect(summary.after).toBeNull()
    expect(summary.basis).toContain('chaesu')
  })
  it('does not present a remapped website tag as the final local author', () => {
    expect(
      creatorReviewSummary('BACKFILL', { ...source, refs: [{ ...source.refs[0], remapped: [{ artistId: 7 }] }] }).after
    ).toBeNull()
  })
  it('distinguishes a missing source from a confirmed empty tag list', () => {
    expect(creatorReviewSummary('BACKFILL', { refs: [{ tags: null }] }).basis).toBe('没有找到原网站的作者信息')
    expect(creatorReviewSummary('BACKFILL', { refs: [{ tags: [] }] }).basis).toBe('原网站没有标注作者')
  })
  it('shows manual additions and removals as operations, not a replacement of every author', () => {
    const add = creatorReviewSummary('ADD', {
      creatorNames: ['现有作者'],
      description: '当前：现有作者；人工追加：另一作者'
    })
    expect(add).toMatchObject({ label: '添加作者／社团', before: '现有作者', after: '另一作者' })
    const remove = creatorReviewSummary('REMOVE', {
      creatorNames: ['现有作者'],
      description: '当前：现有作者；排除归属：现有作者'
    })
    expect(remove.label).toBe('移除作者／社团')
  })
})
