import type { artworkDedupSelectionSchema } from '@pixishelf/job-contracts'
import type { z } from 'zod'

export type DuplicateSelection = { input: z.input<typeof artworkDedupSelectionSchema>; copies: Record<string, number> }
export function emptyDuplicateSelection(): DuplicateSelection {
  return { input: { kind: 'EXPLICIT', groupIds: [] }, copies: {} }
}
export function isDuplicateGroupSelected(selection: DuplicateSelection, groupId: string, eligible: boolean) {
  return selection.input.kind === 'EXPLICIT'
    ? selection.input.groupIds.includes(groupId)
    : eligible && !selection.input.excludedGroupIds?.includes(groupId)
}
export function toggleDuplicateGroup(
  selection: DuplicateSelection,
  groupId: string,
  checked: boolean,
  copies: number
): DuplicateSelection {
  if (selection.input.kind === 'EXPLICIT') {
    const groupIds = checked
      ? [...new Set([...selection.input.groupIds, groupId])]
      : selection.input.groupIds.filter((id) => id !== groupId)
    if (groupIds.length > 1000) throw new Error('一次最多选择 1,000 组，请分批预览。')
    return { input: { kind: 'EXPLICIT', groupIds }, copies: { ...selection.copies, [groupId]: copies } }
  }
  const excludedGroupIds = checked
    ? (selection.input.excludedGroupIds ?? []).filter((id) => id !== groupId)
    : [...new Set([...(selection.input.excludedGroupIds ?? []), groupId])]
  if (excludedGroupIds.length > 1000) throw new Error('一次最多排除 1,000 组，请改为分批选择。')
  return { input: { kind: 'ALL_RECOMMENDED', excludedGroupIds }, copies: {} }
}
export function duplicateSelectionSummary(selection: DuplicateSelection, recommendedCount: number) {
  if (selection.input.kind === 'ALL_RECOMMENDED') {
    // Excluded IDs can outlive recommendation eligibility; their current intersection is server-owned.
    return {
      groups: null,
      copies: null,
      recommendedGroups: recommendedCount,
      excludedGroups: selection.input.excludedGroupIds?.length ?? 0
    }
  }
  return {
    groups: selection.input.groupIds.length,
    copies: selection.input.groupIds.reduce((total, id) => total + (selection.copies[id] ?? 0), 0)
  }
}
