import type { MediaType } from '@prisma/client'
import { isApngFile, isGifFile, isImageFile, isVideoFile } from '@/lib/media'

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
