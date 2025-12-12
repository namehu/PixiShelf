// ============================================================================
// 媒体类型定义
// ============================================================================
import { isVideoFile, isImageFile, getFileExtension } from '../../lib/media'

export { isVideoFile, isImageFile }

/**
 * 媒体文件类型枚举
 */
export enum MediaType {
  IMAGE = 'image',
  VIDEO = 'video'
}

/**
 * 媒体文件信息接口
 */
export interface MediaFileInfo {
  /** 文件路径 */
  path: string
  /** 文件名 */
  filename: string
  /** 文件扩展名 */
  extension: string
  /** 文件大小（字节） */
  size: number
  /** 媒体类型 */
  type: MediaType
  /** 关联的作品ID */
  artworkId: string
  /** 页面索引（从0开始） */
  pageIndex: number
  /** 排序顺序 */
  sortOrder: number
}

/**
 * 视频元数据接口
 */
export interface VideoMetadata {
  /** 视频时长（秒） */
  duration?: number
  /** 视频宽度 */
  width?: number
  /** 视频高度 */
  height?: number
  /** 比特率 */
  bitrate?: number
  /** 帧率 */
  framerate?: number
  /** 编解码器 */
  codec?: string
}

/**
 * 扩展的图片信息接口（包含媒体类型）
 */
export interface ExtendedImage {
  id: number
  path: string
  width?: number | null
  height?: number | null
  size?: number | null
  type: MediaType
  videoMetadata?: VideoMetadata | null
  artworkId?: number | null
  createdAt: string
  updatedAt: string
}

/**
 * 获取媒体文件类型
 * @param filename 文件名或文件路径
 * @returns 媒体类型，如果不支持则返回null
 */
export function getMediaType(filename: string): MediaType | null {
  if (isVideoFile(filename)) {
    return MediaType.VIDEO
  }
  if (isImageFile(filename)) {
    return MediaType.IMAGE
  }
  return null
}

/**
 * 判断文件是否为支持的媒体格式
 * @param filename 文件名或文件路径
 * @returns 是否为支持的媒体文件
 */
export function isSupportedMediaFile(filename: string): boolean {
  return getMediaType(filename) !== null
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
    '.mkv': 'video/x-matroska'
  }

  return imageMimeTypes[ext] || videoMimeTypes[ext] || null
}

/**
 * 类型守卫：检查是否为视频元数据
 * @param metadata 元数据对象
 * @returns 是否为视频元数据
 */
export function isVideoMetadata(metadata: any): metadata is VideoMetadata {
  return (
    metadata &&
    typeof metadata === 'object' &&
    (typeof metadata.duration === 'number' || typeof metadata.duration === 'undefined')
  )
}
