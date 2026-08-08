import type { MediaType } from '@prisma/client'
import { getFileExtension, isApngFile, isGifFile, isImageFile, isVideoFile } from '@/lib/media'

const ANIMATION_CONTENT_SCAN_EXTENSIONS = new Set(['.webp', '.gif', '.png', '.apng'])

/**
 * 根据入库路径确定数据库媒体类型。
 *
 * 这里只做可重复、低成本的扩展名分类；视频的编码、音频等信息仍由媒体探测任务处理。
 */
export function inferMediaTypeFromPath(mediaPath: string): MediaType {
  if (isVideoFile(mediaPath)) return 'VIDEO'
  if (isApngFile(mediaPath) || isGifFile(mediaPath)) return 'ANIMATION'
  if (isImageFile(mediaPath)) return 'IMAGE'
  return 'UNKNOWN'
}

/** WebP/GIF/PNG/APNG 需要读取内容后才能可靠区分单帧和动画。 */
export function needsAnimationContentScan(mediaPath: string): boolean {
  return ANIMATION_CONTENT_SCAN_EXTENSIONS.has(getFileExtension(mediaPath))
}
