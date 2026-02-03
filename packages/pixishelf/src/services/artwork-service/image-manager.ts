import { prisma } from '@/lib/prisma'
import fs from 'fs/promises'
import path from 'path'
import { getScanPath } from '@/services/setting.service'

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

/**
 * 删除单个图片
 * @param imageId 图片ID
 * @param deleteFile 是否同时删除物理文件
 */
export async function deleteImage(imageId: number, deleteFile: boolean) {
  // 1. 获取图片信息
  const image = await prisma.image.findUnique({
    where: { id: imageId }
  })

  if (!image) {
    throw new Error('Image not found')
  }

  // 2. 如果需要删除文件，执行物理删除
  if (deleteFile) {
    const scanPath = await getScanPath()
    if (scanPath) {
      let fullPath = path.resolve(scanPath, `${image.path}`.replace(/^\//, ''))

      try {
        // 检查文件是否存在
        await fs.access(fullPath)
        // 删除文件
        await fs.unlink(fullPath)
      } catch (error: any) {
        // 如果是文件不存在，可以忽略错误继续删除数据库记录
        if (error.code !== 'ENOENT') {
          console.error(`Failed to delete file: ${fullPath}`, error)
          throw new Error(`Failed to delete physical file: ${error.message}`)
        }
      }
    }
  }

  // 3. 删除数据库记录
  await prisma.image.delete({
    where: { id: imageId }
  })

  return true
}
