export function getPreferredTagName(
  preferredTags: string[],
  tags: Array<{ name: string }> | undefined
): string {
  if (preferredTags.length === 0 || !tags || tags.length === 0) {
    return ''
  }

  const artworkTagNames = new Set(tags.map((tag) => tag.name))
  return preferredTags.find((tag) => artworkTagNames.has(tag)) || ''
}
