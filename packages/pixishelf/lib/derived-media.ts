export const VIDEO_POSTER_PUBLIC_PREFIX = '/_video-posters/'
export const VIDEO_CHAPTER_PREVIEW_PUBLIC_PREFIX = '/_video-chapter-previews/'
export const VIDEO_KEYFRAME_PUBLIC_PREFIX = '/_video-keyframes/'

export const VIDEO_POSTER_IMGPROXY_PREFIX = '/derived-media/video/posters'
export const VIDEO_CHAPTER_PREVIEW_IMGPROXY_PREFIX = '/derived-media/video/chapters'
export const VIDEO_KEYFRAME_IMGPROXY_PREFIX = '/derived-media/video/keyframes'

export type DerivedMediaKind = 'VIDEO_POSTER' | 'VIDEO_CHAPTER_PREVIEW' | 'VIDEO_KEYFRAME'

const DERIVED_MEDIA_ROUTES: Record<DerivedMediaKind, { publicPrefix: string; imgproxyPrefix: string }> = {
  VIDEO_POSTER: {
    publicPrefix: VIDEO_POSTER_PUBLIC_PREFIX,
    imgproxyPrefix: VIDEO_POSTER_IMGPROXY_PREFIX
  },
  VIDEO_CHAPTER_PREVIEW: {
    publicPrefix: VIDEO_CHAPTER_PREVIEW_PUBLIC_PREFIX,
    imgproxyPrefix: VIDEO_CHAPTER_PREVIEW_IMGPROXY_PREFIX
  },
  VIDEO_KEYFRAME: {
    publicPrefix: VIDEO_KEYFRAME_PUBLIC_PREFIX,
    imgproxyPrefix: VIDEO_KEYFRAME_IMGPROXY_PREFIX
  }
}

export interface ResolvedDerivedMediaSource {
  kind: DerivedMediaKind
  relativePath: string
  imgproxySourcePath: string
  version: string | null
}

/** 校验已经解码、且相对于某类派生媒体根目录的路径。 */
export function normalizeDerivedMediaRelativePath(relativePath: string): string | null {
  const hasControlCharacter = Array.from(relativePath).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0
    return codePoint <= 31 || codePoint === 127
  })
  if (!relativePath || relativePath.includes('\\') || hasControlCharacter) {
    return null
  }

  const segments = relativePath.split('/')
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    return null
  }

  return segments.join('/')
}

export function encodeDerivedMediaRelativePath(relativePath: string): string {
  const normalized = normalizeDerivedMediaRelativePath(relativePath)
  if (!normalized) {
    throw new Error(`Invalid derived media path: ${relativePath}`)
  }

  return normalized
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

export function buildDerivedMediaPublicUrl(
  kind: DerivedMediaKind,
  relativePath: string,
  updatedAt?: Date | string | number | null
): string {
  const baseUrl = `${DERIVED_MEDIA_ROUTES[kind].publicPrefix}${encodeDerivedMediaRelativePath(relativePath)}`
  if (updatedAt == null) {
    return baseUrl
  }

  const version = new Date(updatedAt).getTime()
  return Number.isFinite(version) ? `${baseUrl}?v=${version}` : baseUrl
}

export function isDerivedMediaPublicUrl(src: string): boolean {
  return Object.values(DERIVED_MEDIA_ROUTES).some((route) => src.startsWith(route.publicPrefix))
}

/** 将应用稳定的虚拟地址解析为 ImgProxy 派生媒体挂载点中的唯一来源路径。 */
export function resolveDerivedMediaSource(src: string): ResolvedDerivedMediaSource | null {
  const routeEntry = Object.entries(DERIVED_MEDIA_ROUTES).find(([, route]) => src.startsWith(route.publicPrefix))
  if (!routeEntry) {
    return null
  }

  const [kind, route] = routeEntry as [DerivedMediaKind, (typeof DERIVED_MEDIA_ROUTES)[DerivedMediaKind]]
  const remainder = src.slice(route.publicPrefix.length)
  const queryIndex = remainder.indexOf('?')
  const encodedPath = queryIndex >= 0 ? remainder.slice(0, queryIndex) : remainder
  const query = queryIndex >= 0 ? remainder.slice(queryIndex + 1) : ''

  let decodedSegments: string[]
  try {
    decodedSegments = encodedPath.split('/').map((segment) => decodeURIComponent(segment))
  } catch {
    return null
  }

  // 分段解码后再次拒绝斜杠，防止编码的 %2F 或 %5C 绕过目录边界校验。
  if (decodedSegments.some((segment) => segment.includes('/') || segment.includes('\\'))) {
    return null
  }

  const relativePath = normalizeDerivedMediaRelativePath(decodedSegments.join('/'))
  if (!relativePath) {
    return null
  }

  return {
    kind,
    relativePath,
    imgproxySourcePath: `${route.imgproxyPrefix}/${relativePath}`,
    version: new URLSearchParams(query).get('v')
  }
}
