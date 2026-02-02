import 'server-only'
import { prisma } from '@/lib/prisma'
import { BatchCreateArtworkSchema, BatchImportArtworkSchema, BatchRegisterImageSchema } from '@/schemas/artwork.dto'
import { getScanPath } from '@/services/setting.service'
import path from 'path'
import fs from 'fs/promises'
import logger from '@/lib/logger'
import { generateLocalExternalId } from './artwork-service/utils'

/**
 * 批量创建作品
 */
export async function batchCreateArtworksService(data: BatchCreateArtworkSchema) {
  const { artworks } = data
  const results: BatchImportArtworkSchema[] = []

  const scanRoot = await getScanPath()

  if (!scanRoot) {
    throw new Error('未配置扫描根目录')
  }

  // 使用交互式事务，因为需要先创建获取 ID，再更新 externalId
  await prisma.$transaction(
    async (tx) => {
      for (const item of artworks) {
        // 1. 创建基础作品记录
        const artwork = await tx.artwork.create({
          data: {
            title: item.title,
            source: 'LOCAL_CREATED',
            sourceDate: new Date(),
            artistId: item.artistId
          }
        })

        // 2. 生成 externalId 并更新
        const externalId = generateLocalExternalId(artwork.id)

        await tx.artwork.update({
          where: { id: artwork.id },
          data: {
            externalId
          }
        })
        logger.info(`Created artwork: ${artwork.id} with externalId: ${externalId}`)

        // 3. 关联标签
        if (item.tagIds.length > 0) {
          logger.info(`Creating tagIds: ${item.tagIds}`)
          await tx.artworkTag.createMany({
            data: item.tagIds.map((tagId) => ({
              artworkId: artwork.id,
              tagId
            }))
          })
        }

        // 4. 准备上传目录
        const targetRelDir = `/${item.artistUserId}/${externalId}`
        const uploadTargetDir = path.join(scanRoot, targetRelDir)
        logger.info(`Creating directory: ${uploadTargetDir}`)
        try {
          await fs.mkdir(uploadTargetDir, { recursive: true })
        } catch (e) {
          logger.warn(`Failed to create directory: ${uploadTargetDir}`)
        }

        results.push(
          BatchImportArtworkSchema.parse({
            tempId: item.tempId,
            id: artwork.id,
            title: artwork.title,
            externalId,
            targetRelDir,
            uploadTargetDir
          })
        )
      }
    },
    {
      timeout: 30000 // 增加超时时间
    }
  )

  return results
}

/**
 * 批量注册图片
 */
export async function batchRegisterImagesService(data: BatchRegisterImageSchema) {
  const { items } = data

  try {
    await prisma.$transaction(async (tx) => {
      for (const item of items) {
        const { artworkId, images } = item
        // 获取作品信息以确定路径
        const artwork = await tx.artwork.findUnique({
          where: { id: artworkId }
        })

        if (!artwork) continue

        // 1. 创建图片记录
        await tx.image.createMany({
          data: images.map((img, index) => {
            return {
              artworkId,
              path: img.path,
              size: img.size,
              width: img.width || 0,
              height: img.height || 0,
              sortOrder: index
            }
          })
        })

        // 2. 更新作品 imageCount
        await tx.artwork.update({
          where: { id: artworkId },
          data: {
            imageCount: images.length
          }
        })
      }
    })
  } catch (error) {
    logger.error(`Failed to register images: ${error}`)
  }

  return { success: true }
}
