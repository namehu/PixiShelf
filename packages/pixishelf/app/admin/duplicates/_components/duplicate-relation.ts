import type { ArtworkDedupGroupDto, ArtworkDedupVisualSummary } from '@pixishelf/job-contracts'

type Relation = Pick<
  ArtworkDedupGroupDto,
  | 'relationKind'
  | 'containedArtworkId'
  | 'containerArtworkId'
  | 'containedFileCount'
  | 'containerFileCount'
  | 'extraFileCount'
>

function count(value: string | null) {
  return value === null ? '未知' : BigInt(value).toLocaleString('zh-CN')
}

export function duplicateContainmentCounts(relation: Relation) {
  return `${count(relation.containedFileCount)} / ${count(relation.containerFileCount)} 项原媒体 · 多出 ${count(relation.extraFileCount)} 项`
}

export function canKeepDuplicateMember(relation: Relation, artworkId: number) {
  return relation.relationKind !== 'CONTAINS' || relation.containerArtworkId === artworkId
}

export function duplicateRelationMemberMetadata(relation: Relation, artworkId: number) {
  if (relation.relationKind !== 'CONTAINS') return undefined
  return artworkId === relation.containerArtworkId
    ? `${count(relation.containerFileCount)} 项原媒体 · 多出 ${count(relation.extraFileCount)} 项`
    : `${count(relation.containedFileCount)} 项原媒体`
}

export function duplicateKeeperRestriction(relation: Relation, artworkId: number) {
  return canKeepDuplicateMember(relation, artworkId) ? undefined : '已被完整包含，需保留完整作品。'
}

export function duplicateVisualSideCounts(visual: ArtworkDedupVisualSummary, artworkId: number) {
  const left = artworkId === visual.leftArtworkId
  const total = BigInt(left ? visual.leftFileCount : visual.rightFileCount)
  const unchecked = BigInt((left ? visual.leftUncheckedCount : visual.rightUncheckedCount) ?? '0')
  return {
    total,
    checked: total - unchecked,
    unchecked,
    unmatched: BigInt(left ? visual.leftUnmatchedCount : visual.rightUnmatchedCount)
  }
}

export function duplicateVisualCounts(visual: ArtworkDedupVisualSummary) {
  const left = duplicateVisualSideCounts(visual, visual.leftArtworkId)
  const right = duplicateVisualSideCounts(visual, visual.rightArtworkId)
  const unchecked = left.unchecked > 0n || right.unchecked > 0n
    ? ` · 未核对：左 ${left.unchecked.toLocaleString('zh-CN')} / 右 ${right.unchecked.toLocaleString('zh-CN')} 项`
    : ''
  return `已配对 ${count(visual.pairedCount)} 张 · 左侧未配对 ${count(visual.leftUnmatchedCount)} 张 · 右侧未配对 ${count(visual.rightUnmatchedCount)} 张${unchecked}`
}

export function isDuplicateManualPair(relation: Pick<ArtworkDedupGroupDto, 'relationKind'>) {
  return relation.relationKind === 'PARTIAL' || relation.relationKind === 'VISUAL'
}

export function duplicatePairLabel(relation: Pick<ArtworkDedupGroupDto, 'relationKind'>) {
  return relation.relationKind === 'PARTIAL' ? '部分重复' : '疑似版本'
}

export function duplicatePairCounts(relation: Pick<ArtworkDedupGroupDto, 'relationKind' | 'visual'>) {
  const summary = relation.visual
  if (!summary) return ''
  if (relation.relationKind !== 'PARTIAL') return duplicateVisualCounts(summary)
  const unmatched =
    summary.leftUnmatchedCount === summary.rightUnmatchedCount
      ? `双方各 ${count(summary.leftUnmatchedCount)} 张未配对`
      : `左侧 ${count(summary.leftUnmatchedCount)} 张未配对 · 右侧 ${count(summary.rightUnmatchedCount)} 张未配对`
  return `${count(summary.exactCount)} 张相同 · ${unmatched}`
}
