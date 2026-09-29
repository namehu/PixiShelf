/** Full addresses are exposed only in authenticated archive item details. */
export function archiveItemUrl(value: string | null | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) return null
    return value
  } catch {
    return null
  }
}
