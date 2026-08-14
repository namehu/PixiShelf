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
