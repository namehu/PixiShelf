import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { duplicatePairCounts, duplicateVisualSideCounts } from '../duplicate-relation'
import { DuplicateVisualRow } from '../duplicate-visual-row'
import { partialGroup, visualGroup, visualSummary } from './duplicate-maintenance-fixtures'

afterEach(cleanup)
describe('duplicate visual coverage', () => {
  it('keeps result coverage concise while distinguishing unchecked and unmatched media', () => {
    const summary = {
      ...visualSummary, leftFileCount: '12', rightFileCount: '16', leftUncheckedCount: '2', rightUncheckedCount: '4'
    }
    render(<DuplicateVisualRow group={visualGroup({ visual: summary })} disabled={false} onDetails={vi.fn()} />)
    expect(screen.getByText('已配对 9 张 · 左侧未配对 1 张 · 右侧未配对 3 张 · 未核对：左 2 / 右 4 项')).toBeTruthy()
    expect(duplicateVisualSideCounts(summary, 1)).toEqual({ total: 12n, checked: 10n, unchecked: 2n, unmatched: 1n })
    expect(duplicateVisualSideCounts(summary, 2)).toEqual({ total: 16n, checked: 12n, unchecked: 4n, unmatched: 3n })
  })

  it('handles zero and historical unchecked counts without inventing missing coverage', () => {
    const legacy = { ...visualSummary }
    Reflect.deleteProperty(legacy, 'leftUncheckedCount')
    Reflect.deleteProperty(legacy, 'rightUncheckedCount')
    expect(duplicatePairCounts(visualGroup())).toBe('已配对 9 张 · 左侧未配对 1 张 · 右侧未配对 3 张')
    expect(duplicatePairCounts(visualGroup({ visual: legacy }))).toBe(duplicatePairCounts(visualGroup()))
    expect(duplicateVisualSideCounts(legacy, 1)).toEqual({ total: 10n, checked: 10n, unchecked: 0n, unmatched: 1n })
    expect(duplicatePairCounts(partialGroup())).toBe('80 张相同 · 双方各 20 张未配对')
  })
})
