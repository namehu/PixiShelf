import { describe, expect, it } from 'vitest'
import {
  duplicateSelectionSummary,
  emptyDuplicateSelection,
  isDuplicateGroupSelected,
  toggleDuplicateGroup
} from '../duplicate-selection'
import { newerDuplicateOperation } from '../duplicate-operation-state'
import { operation } from './duplicate-maintenance-fixtures'

describe('duplicate review ranges', () => {
  it('preserves explicit groups and copy counts across pages, without selecting a keeper implicitly', () => {
    let selection = emptyDuplicateSelection()
    expect(isDuplicateGroupSelected(selection, 'group-1', true)).toBe(false)
    selection = toggleDuplicateGroup(selection, 'group-1', true, 2)
    selection = toggleDuplicateGroup(selection, 'group-on-next-page', true, 4)
    expect(duplicateSelectionSummary(selection, 100)).toEqual({ groups: 2, copies: 6 })
    expect(isDuplicateGroupSelected(selection, 'group-1', true)).toBe(true)
    selection = toggleDuplicateGroup(selection, 'group-1', false, 2)
    expect(duplicateSelectionSummary(selection, 100)).toEqual({ groups: 1, copies: 4 })
  })
  it('all recommended uses the full server count and only sends exclusions', () => {
    const selection = toggleDuplicateGroup(
      { input: { kind: 'ALL_RECOMMENDED', excludedGroupIds: [] }, copies: {} },
      'excluded',
      false,
      99
    )
    expect(selection.input).toEqual({ kind: 'ALL_RECOMMENDED', excludedGroupIds: ['excluded'] })
    expect(duplicateSelectionSummary(selection, 2100)).toEqual({
      groups: null,
      copies: null,
      recommendedGroups: 2100,
      excludedGroups: 1
    })
    expect(isDuplicateGroupSelected(selection, 'unloaded-page', true)).toBe(true)
    expect(isDuplicateGroupSelected(selection, 'blocked', false)).toBe(false)
  })
  it('does not treat a formerly eligible excluded group as an empty remaining range', () => {
    const selection = { input: { kind: 'ALL_RECOMMENDED' as const, excludedGroupIds: ['A'] }, copies: {} }
    expect(duplicateSelectionSummary(selection, 1)).toEqual({
      groups: null,
      copies: null,
      recommendedGroups: 1,
      excludedGroups: 1
    })
    expect(isDuplicateGroupSelected(selection, 'A', false)).toBe(false)
    expect(isDuplicateGroupSelected(selection, 'B', true)).toBe(true)
  })
  it('refuses to silently truncate a range above the contract bound', () => {
    expect(() =>
      toggleDuplicateGroup(
        { input: { kind: 'EXPLICIT', groupIds: Array.from({ length: 1000 }, (_, i) => `g-${i}`) }, copies: {} },
        'extra',
        true,
        1
      )
    ).toThrow('1,000')
  })
})
describe('operation response order', () => {
  it('retains a newer version or checkpoint and refuses a different operation', () => {
    const current = operation({ version: 5, status: 'ISOLATED', updatedAt: '2026-10-24T00:10:00Z' })
    expect(newerDuplicateOperation(current, operation({ version: 4, status: 'ISOLATING' }))).toBe(current)
    expect(newerDuplicateOperation(current, operation({ version: 5, updatedAt: '2026-10-24T00:09:00Z' }))).toBe(current)
    expect(newerDuplicateOperation(current, operation({ operationId: 'old-op', version: 6 }))).toBe(current)
    expect(newerDuplicateOperation(current, operation({ version: 6, status: 'PURGING' })).status).toBe('PURGING')
  })
})
