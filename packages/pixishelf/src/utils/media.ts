import { getFileExtension } from '../../lib/media'

/**
 * 格式化文件大小
 * @param bytes 文件大小（字节）
 * @param decimals 保留的小数位数，默认为 1
 * @returns 格式化后的字符串 (e.g., "1.5 MB")
 */
export const formatFileSize = (bytes: number, decimals: number = 1): string => {
  if (bytes === 0) return '0 B'

  const k = 1024
  const dm = decimals < 0 ? 0 : decimals
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB']

  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i]
}

/**
 * 获取媒体文件的MIME类型
 * @param filename 文件名或文件路径
 * @returns MIME类型，如果不支持则返回null
 */
export function getMediaMimeType(filename: string): string | null {
  const ext = getFileExtension(filename)

  // 图片MIME类型映射
  const imageMimeTypes: Record<string, string> = {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.gif': 'image/gif',
    '.bmp': 'image/bmp',
    '.webp': 'image/webp',
    '.svg': 'image/svg+xml',
    '.tiff': 'image/tiff',
    '.tif': 'image/tiff'
  }

  // 视频MIME类型映射
  const videoMimeTypes: Record<string, string> = {
    '.mp4': 'video/mp4',
    '.avi': 'video/x-msvideo',
    '.mov': 'video/quicktime',
    '.wmv': 'video/x-ms-wmv',
    '.flv': 'video/x-flv',
    '.webm': 'video/webm',
    '.mkv': 'video/x-matroska',
    '.ogg': 'video/ogg'
  }

  return imageMimeTypes[ext] || videoMimeTypes[ext] || null
}
