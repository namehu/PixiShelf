import type { ArtworkResponseDto } from '@/schemas/artwork.dto'

export function getPreferredTagName(
  preferredTags: string[],
  tags: Pick<ArtworkResponseDto, 'tags'>['tags'] | undefined
): string {
  if (preferredTags.length === 0 || !tags || tags.length === 0) {
    return ''
  }

  const artworkTagNames = new Set(tags.map((tag) => tag.name))
  return preferredTags.find((tag) => artworkTagNames.has(tag)) || ''
}
