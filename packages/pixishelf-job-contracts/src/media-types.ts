export const IMAGE_FILE_EXTENSIONS = Object.freeze([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.bmp',
  '.webp',
  '.svg',
  '.tiff',
  '.tif',
  '.apng'
] as const)

export const VIDEO_FILE_EXTENSIONS = Object.freeze([
  '.mp4',
  '.avi',
  '.mov',
  '.wmv',
  '.flv',
  '.webm',
  '.mkv',
  '.m4v'
] as const)

export const MEDIA_FILE_EXTENSIONS = Object.freeze([...IMAGE_FILE_EXTENSIONS, ...VIDEO_FILE_EXTENSIONS] as const)

export const ANIMATION_CONTENT_SCAN_EXTENSIONS = Object.freeze(['.webp', '.gif', '.png', '.apng'] as const)

export type InitialMediaType = 'IMAGE' | 'VIDEO' | 'ANIMATION' | 'UNKNOWN'

/** Accepts a path (or extension); query strings are ignored for App URL callers. */
export function getMediaFileExtension(mediaPath: string): string {
  const filename = (mediaPath.split('?')[0] ?? '').replace(/\\/g, '/').split('/').at(-1) ?? ''
  const dot = filename.lastIndexOf('.')
  return dot < 0 ? '' : filename.slice(dot).toLowerCase()
}

/** Initial classification only. Never replace a confirmed content result with this hint. */
export function inferMediaTypeFromPath(mediaPath: string): InitialMediaType {
  const extension = getMediaFileExtension(mediaPath)
  if ((VIDEO_FILE_EXTENSIONS as readonly string[]).includes(extension)) return 'VIDEO'
  if (extension === '.gif' || extension === '.apng') return 'ANIMATION'
  if ((IMAGE_FILE_EXTENSIONS as readonly string[]).includes(extension)) return 'IMAGE'
  return 'UNKNOWN'
}

/** WebP/GIF/PNG/APNG need a content probe to distinguish static and animated media. */
export function needsAnimationContentScan(mediaPath: string): boolean {
  return (ANIMATION_CONTENT_SCAN_EXTENSIONS as readonly string[]).includes(getMediaFileExtension(mediaPath))
}
