/**
 * 支持的图片格式
 */
export const IMAGE_EXTENSIONS = [
  '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.webp', '.svg', '.tiff', '.tif', '.apng'
]

/**
 * 支持的视频格式
 */
export const VIDEO_EXTENSIONS = [
  '.mp4', '.avi', '.mov', '.wmv', '.flv', '.webm', '.mkv'
]

/**
 * 所有支持的媒体格式
 */
export const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS]
