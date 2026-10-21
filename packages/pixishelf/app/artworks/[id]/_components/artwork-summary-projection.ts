import type { ArtworkSummaryGroup } from '@pixishelf/job-contracts'

export interface SummaryDecoration {
  group: ArtworkSummaryGroup
  first: boolean
  last: boolean
  expanded: boolean
  representativeId: number
  visibleCount: number
}

/** Intersect frozen unread IDs with the original groups; never regroup across a gap. */
export function projectArtworkSummary<T extends { id: number }>(images: T[], groups: ArtworkSummaryGroup[], expanded: ReadonlySet<string>) {
  const byId = new Map(images.map((image) => [image.id, image]))
  const displayed: T[] = []
  const decorations = new Map<number, SummaryDecoration>()
  for (const group of groups) {
    const members = group.mediaIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : [])
    if (!members.length) continue
    const open = expanded.has(group.id)
    const visible = open ? members : members.slice(0, 1)
    displayed.push(...visible)
    visible.forEach((image, index) => decorations.set(image.id, { group, first: index === 0,
      last: index === visible.length - 1, expanded: open, representativeId: members[0]!.id, visibleCount: members.length }))
  }
  return { images: displayed, decorations }
}
