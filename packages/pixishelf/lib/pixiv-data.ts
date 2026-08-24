export const PIXIV_DATA_API_PREFIX = '/api/pixiv-data/'

export const PIXIV_DATA_ROOTS = ['artists', 'tags'] as const

export type PixivDataRoot = (typeof PIXIV_DATA_ROOTS)[number]

const PIXIV_DATA_ROOT_SET = new Set<string>(PIXIV_DATA_ROOTS)

export function isPixivDataRoot(value: string): value is PixivDataRoot {
  return PIXIV_DATA_ROOT_SET.has(value)
}

export function buildPixivArtistAvatarUrl(userId?: string | null, avatar?: string | null): string {
  return buildPixivDataUrl('artists', [userId, avatar])
}

export function buildPixivArtistBackgroundUrl(userId?: string | null, backgroundImg?: string | null): string {
  return buildPixivDataUrl('artists', [userId, backgroundImg])
}

export function buildPixivTagImageUrl(image?: string | null): string {
  return buildPixivDataUrl('tags', [image], { trimLeadingSlashes: true })
}

function buildPixivDataUrl(
  root: PixivDataRoot,
  rawSegments: Array<string | null | undefined>,
  options?: { trimLeadingSlashes?: boolean }
): string {
  const encodedSegments: string[] = []

  for (const rawSegment of rawSegments) {
    const segment = options?.trimLeadingSlashes ? rawSegment?.replace(/^\/+/, '') : rawSegment
    if (!isSafePixivDataSegment(segment)) return ''
    encodedSegments.push(encodeURIComponent(segment))
  }

  return `${PIXIV_DATA_API_PREFIX}${root}/${encodedSegments.join('/')}`
}

function isSafePixivDataSegment(segment?: string | null): segment is string {
  if (!segment || segment === '.' || segment === '..' || segment.includes('/') || segment.includes('\\')) return false

  return !Array.from(segment).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
}
