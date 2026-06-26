import 'server-only'
import { prisma } from '@/lib/prisma'
import { BatchCreateArtworkSchema, BatchImportArtworkSchema, BatchRegisterImageSchema } from '@/schemas/artwork.dto'
import { getScanPath } from '@/services/setting.service'
import path from 'path'
import fs from 'fs/promises'
import logger from '@/lib/logger'
import { generateLocalExternalId } from './artwork-service/utils'
import { syncMediaDerivedTagsForArtworks } from './media-derived-tag-service'
import { ESource } from '@/enums/ESource'
import { ScanRunMode, ScanRunType } from '@prisma/client'
import {
  appendScanRunItems,
  completeScanRunSummary,
  failScanRun,
  startScanRun,
  updateScanRunItemMedia
} from './scan-run-service'

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

  const scanRun = await startScanRun({
    type: ScanRunType.BATCH_IMPORT,
    mode: ScanRunMode.BATCH_CREATE
  })

  // 使用交互式事务，因为需要先创建获取 ID，再更新 externalId
  try {
    await prisma.$transaction(
      async (tx) => {
        for (const item of artworks) {
          // 1. 创建基础作品记录
          const artwork = await tx.artwork.create({
            data: {
              title: item.title,
              source: ESource.LOCAL_CREATED,
              sourceDate: item.sourceDate ? new Date(item.sourceDate) : new Date(),
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
          } catch (_e) {
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
  } catch (error) {
    const message = error instanceof Error ? error.message : '批量创建作品失败'
    await failScanRun(scanRun.id, message)
    throw error
  }

  await appendScanRunItems(
    results.map((item) => ({
      scanRunId: scanRun.id,
      externalId: item.externalId,
      title: item.title,
      relativeDirectory: normalizeRelativePath(item.targetRelDir),
      status: 'SUCCESS',
      action: 'CREATE',
      mediaCount: 0,
      newImageCount: 0,
      finishedAt: new Date()
    }))
  )
  await completeScanRunSummary(scanRun.id, {
    totalArtworks: results.length,
    durationMs: undefined,
    newImages: 0
  })

  return { scanRunId: scanRun.id, artworks: results }
}

/**
 * 批量注册图片
 */
export async function batchRegisterImagesService(data: BatchRegisterImageSchema) {
  const { items, scanRunId } = data

  try {
    await prisma.$transaction(async (tx) => {
      const artworkIdsToSync = new Set<number>()

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

        artworkIdsToSync.add(artworkId)
      }

      await syncMediaDerivedTagsForArtworks(tx, Array.from(artworkIdsToSync))
    })

    if (scanRunId) {
      await updateBatchImportAuditMedia(scanRunId, items)
      await completeScanRunSummary(scanRunId, {
        totalArtworks: items.length,
        durationMs: undefined,
        newImages: items.reduce((total, item) => total + item.images.length, 0)
      })
    }
  } catch (error) {
    logger.error(`Failed to register images: ${error}`)
    if (scanRunId) {
      const message = error instanceof Error ? error.message : '批量注册图片失败'
      await recordBatchRegisterFailure(scanRunId, items, message)
      await failScanRun(scanRunId, message)
    }
    throw error
  }

  return { success: true }
}

async function updateBatchImportAuditMedia(scanRunId: string, items: BatchRegisterImageSchema['items']) {
  const artworks = await prisma.artwork.findMany({
    where: { id: { in: items.map((item) => item.artworkId) } },
    select: { id: true, externalId: true }
  })
  const externalIdByArtworkId = new Map(artworks.map((artwork) => [artwork.id, artwork.externalId]))

  for (const item of items) {
    const externalId = externalIdByArtworkId.get(item.artworkId)
    if (!externalId) continue
    await updateScanRunItemMedia({
      scanRunId,
      externalId,
      mediaCount: item.images.length,
      newImageCount: item.images.length
    })
  }
}

async function recordBatchRegisterFailure(
  scanRunId: string,
  items: BatchRegisterImageSchema['items'],
  errorMessage: string
) {
  const artworks = await prisma.artwork.findMany({
    where: { id: { in: items.map((item) => item.artworkId) } },
    select: { id: true, externalId: true, title: true, storagePath: true }
  })

  const artworkById = new Map(artworks.map((artwork) => [artwork.id, artwork]))
  await appendScanRunItems(
    items.map((item) => {
      const artwork = artworkById.get(item.artworkId)
      return {
        scanRunId,
        externalId: artwork?.externalId ?? String(item.artworkId),
        title: artwork?.title ?? null,
        relativeDirectory: artwork?.storagePath ?? null,
        status: 'FAILED',
        action: 'FAILED_WRITE',
        mediaCount: item.images.length,
        errorMessage,
        finishedAt: new Date()
      }
    })
  )
}

function normalizeRelativePath(value: string) {
  return value.replace(/^[/\\]+/, '').replace(/\\/g, '/')
}
