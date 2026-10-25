import type { ArtworkDedupGroupDto } from '@pixishelf/job-contracts'

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
  return relation.relationKind === 'EXACT' || relation.containerArtworkId === artworkId
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
