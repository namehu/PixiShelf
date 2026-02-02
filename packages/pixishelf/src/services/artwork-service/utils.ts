import 'server-only'

import path from 'path'
import { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { TImageModel } from '@/schemas/models'
import { isApngFile, isVideoFile } from '../../../lib/media'
import dayjs from 'dayjs'

/**
 * 转换单个作品数据为 DTO 格式
 */
export function transformSingleArtwork(artwork: any) {
  const _count = artwork._count?.images || artwork.imageCount || 0
  const { images, totalMediaSize, imageCount, hasVideo } = transformImages(artwork.images, _count)

  // 构建响应对象
  const result = {
    ...artwork,
    sourceDate: artwork.sourceDate ? dayjs(artwork.sourceDate).format('YYYY-MM-DD HH:mm:ss') : null,
    images: images,
    firstImagePath: images.length > 0 ? path.dirname(images[0]!.path) : null, // 新增：首图路径
    tags: artwork.artworkTags?.map((at: any) => at.tag.name) || [],
    imageCount,
    isVideo: hasVideo,
    totalMediaSize,
    descriptionLength: artwork.descriptionLength || artwork.description?.length || 0,
    artist: artwork.artist
      ? {
          ...artwork.artist,
          artworksCount: 0 // 注意：列表查询通常不包含艺术家的作品总数，除非再联表查
        }
      : null
  }

  // 清理不需要输出到前端的临时字段 (虽然 JS 中 delete 性能一般，但在这里为了通过类型检查或减少 payload 可行)
  delete result.artworkTags
  delete result._count

  return result
}

/**
 * 转换图片模型为 DTO 格式
 * @param images 图片模型数组
 * @param dbImageCount 数据库中记录的图片总数（可选）
 * @returns 转换后的图片 DTO 数组
 */
export function transformImages(images: TImageModel[], dbImageCount?: number) {
  // 1. 直接转 DTO，保留数据库排序
  const allItems = images.map((image) =>
    ArtworkImageResponseDto.parse({
      ...image,
      mediaType: isVideoFile(image.path) ? 'video' : 'image'
    })
  )

  // 2. 核心逻辑：过滤并挂载
  const finalItems = allItems.filter((item) => {
    // 只有 APNG 需要检查是否要被合并
    if (isApngFile(item.path)) {
      const stem = getStem(item.path)

      // 在列表中寻找是否存在同名的视频文件 (Webm/Mp4)
      // 注意：这里利用了引用传递，找到的 videoOwner 就是数组里的同一个对象
      const videoOwner = allItems.find((i) => i !== item && i.mediaType === 'video' && getStem(i.path) === stem)

      if (videoOwner) {
        // 找到了主人：把自己挂载到视频对象上 (作为原始资源)
        // 你可能需要去扩展一下 TS 类型定义，或者暂时用 (videoOwner as any)
        Object.assign(videoOwner, { raw: item })

        // 返回 false -> 从最终列表中移除这个 APNG
        return false
      }
    }
    // 其他情况（普通图片、视频、无主的APNG）都保留
    return true
  })

  // 3. 统计逻辑（基于合并后的 finalItems）
  const hasVideo = finalItems.some((img) => img.mediaType === 'video')

  // 计算总大小
  const totalMediaSize = finalItems.reduce((sum, img) => sum + (img.size || 0), 0)

  return {
    images: finalItems,
    hasVideo,
    imageCount: hasVideo ? 0 : (dbImageCount ?? finalItems.length),
    totalMediaSize
  }
}

/*
 * 这是一个原地(in-place)打乱数组的优秀算法，比 sort + Math.random() 更随机、更高效。
 * @param array 需要打乱的数组
 */
export function shuffleArray<T>(array: T[]): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const temp = array[i]!
    array[i] = array[j]!
    array[j] = temp // 使用临时变量交换元素，避免解构赋值可能引发的类型错误
  }
  return array
}

// 辅助：获取不带后缀的文件名
export const getStem = (p: string) => {
  const name = path.basename(p)
  const ext = path.extname(name)
  return name.slice(0, name.length - ext.length)
}

export const generateLocalExternalId = (artworkId: number) => {
  const randomSuffix = Math.floor(1000000 + Math.random() * 9000000).toString()
  return `e_${artworkId}_${randomSuffix}`
}
