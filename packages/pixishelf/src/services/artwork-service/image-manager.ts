import { prisma } from '@/lib/prisma'

/**
 * 图片元数据接口
 */
export interface ImageMeta {
  fileName: string
  order: number
  width: number
  height: number
  size: number
  path: string // 存储在数据库中的相对路径
}

/**
 * 全量替换作品图片事务
 * 执行逻辑：
 * 1. 删除该作品关联的所有旧 Image 记录
 * 2. 批量插入新的 Image 记录
 *
 * @param artworkId 作品ID
 * @param files 图片元数据列表
 */
export async function updateArtworkImagesTransaction(artworkId: number, files: ImageMeta[]) {
  return await prisma.$transaction(async (tx) => {
    // 1. 删除旧图片记录
    await tx.image.deleteMany({
      where: { artworkId }
    })

    // 2. 准备新图片数据
    const newImages = files.map((file) => ({
      artworkId,
      path: file.path,
      sortOrder: file.order,
      width: file.width,
      height: file.height,
      size: file.size
    }))

    // 3. 批量创建新图片
    if (newImages.length > 0) {
      await tx.image.createMany({
        data: newImages
      })
    }
  })
}
