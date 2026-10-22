import type { ArtworkStackGroup } from '@/lib/reading/artwork-stacks'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'

export interface StackDecoration {
  group: ArtworkStackGroup
  cover: ArtworkImageResponseDto
  mediaIds: number[]
  activeIndex: number
}

export function projectArtworkStacks(images: ArtworkImageResponseDto[], groups: ArtworkStackGroup[], active: ReadonlyMap<string, number>) {
  const byId = new Map(images.map((image) => [image.id, image]))
  const displayed: ArtworkImageResponseDto[] = []
  const decorations = new Map<number, StackDecoration>()
  for (const group of groups) {
    const mediaIds = group.mediaIds.filter((id) => byId.has(id))
    if (!mediaIds.length) continue
    const activeIndex = Math.max(0, mediaIds.indexOf(active.get(group.id) ?? -1))
    const image = byId.get(mediaIds[activeIndex]!)!
    displayed.push(image)
    decorations.set(image.id, { group, cover: byId.get(mediaIds[0]!)!, mediaIds, activeIndex })
  }
  return { images: displayed, decorations }
}
