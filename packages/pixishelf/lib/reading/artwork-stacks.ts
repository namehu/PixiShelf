import type { MediaIndexItem } from '@/schemas/artwork-reader.dto'

export const ARTWORK_STACK_RULE_VERSION = 1 as const
export const ARTWORK_STACK_CONFLICT = 'ARTWORK_STACK_CONFLICT'
export const ARTWORK_SUMMARY_RETIRED_MESSAGE = '视觉摘要已由即时堆叠浏览替代，请刷新作品详情。'

export interface ArtworkStackGroup {
  id: string
  mediaIds: number[]
  representativeMediaId: number
  startIndex: number
  endIndex: number
}

type StackItem = Pick<MediaIndexItem, 'mediaId' | 'memberMediaIds' | 'index' | 'mediaType' | 'isAnimated'>
export function isStackableImage(item: StackItem) {
  return item.mediaType === 'image' && !item.isAnimated && item.memberMediaIds.length === 1
}

/** Partition the complete index before applying filters; non-static media are hard boundaries. */
export function buildArtworkStacks(items: readonly StackItem[]): ArtworkStackGroup[] {
  const capacity = Math.min(8, Math.max(4, Math.ceil(items.filter(isStackableImage).length / 80)))
  const groups: ArtworkStackGroup[] = []
  const append = (members: readonly StackItem[]) => {
    const first = members[0]!
    const last = members.at(-1)!
    groups.push({ id: `stack-v1-${first.mediaId}-${last.mediaId}`, mediaIds: members.map((item) => item.mediaId),
      representativeMediaId: first.mediaId, startIndex: first.index, endIndex: last.index })
  }
  for (let start = 0; start < items.length;) {
    if (!isStackableImage(items[start]!)) { append([items[start]!]); start++; continue }
    let end = start + 1
    while (end < items.length && isStackableImage(items[end]!)) end++
    const count = Math.ceil((end - start) / capacity)
    const size = Math.floor((end - start) / count)
    const remainder = (end - start) % count
    for (let group = 0; group < count; group++) {
      const next = start + size + (group < remainder ? 1 : 0)
      append(items.slice(start, next))
      start = next
    }
  }
  return groups
}
