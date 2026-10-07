/** Validate the original locator without fetching it or depending on resolved metadata. */
export function archiveSubmittedSourceUrl(input: string): string | null {
  try {
    const url = new URL(input)
    if (
      url.protocol !== 'https:' ||
      url.hostname !== 'e-hentai.org' ||
      url.port ||
      url.username ||
      url.password ||
      !/^\/(?:g\/[1-9]\d*\/[a-z0-9]+|s\/[a-z0-9]+\/[1-9]\d*-[1-9]\d*)\/?$/i.test(url.pathname)
    ) {
      return null
    }
    return url.toString()
  } catch {
    return null
  }
}
