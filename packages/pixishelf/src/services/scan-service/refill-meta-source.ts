import path from 'path'
import { promises as fs } from 'fs'
import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { sleep } from '@/utils/sleep'

export interface RefillOptions {
  scanPath: string
  onProgress?: (progress: { message: string; percentage: number }) => Promise<void> | void
  checkCancelled?: () => Promise<boolean>
}

export async function refillMetaSource(options: RefillOptions) {
  const { scanPath, onProgress, checkCancelled } = options

  logger.info('Starting refill meta source task (DB based)', { scanPath })

  if (onProgress) await onProgress({ message: '正在计算待处理作品...', percentage: 0 })

  // 1. 获取所有待处理 ID
  // 我们只关心那些 metaSource 为空 且 externalId 不为空 的作品
  const allIds = await prisma.artwork.findMany({
    where: {
      metaSource: null,
      externalId: { not: null }
    },
    select: { id: true }
  })

  const totalIds = allIds.length
  logger.info(`Found ${totalIds} artworks missing metaSource`)

  if (totalIds === 0) {
    if (onProgress) await onProgress({ message: '没有发现需要补全的作品', percentage: 100 })
    return { updatedCount: 0, totalFiles: 0 }
  }

  let processedCount = 0
  let updatedCount = 0
  const BATCH_SIZE = 50

  // 2. 分批处理
  for (let i = 0; i < totalIds; i += BATCH_SIZE) {
    if (checkCancelled && (await checkCancelled())) {
      throw new Error('Task cancelled')
    }

    const batchIds = allIds.slice(i, i + BATCH_SIZE).map((item) => item.id)

    // 查询详情
    const artworks = await prisma.artwork.findMany({
      where: { id: { in: batchIds } },
      select: {
        id: true,
        externalId: true,
        images: {
          take: 1,
          select: { path: true },
          orderBy: { sortOrder: 'asc' }
        }
      }
    })

    const updates = []

    for (const artwork of artworks) {
      if (!artwork.externalId) continue

      // 只有当存在图片时，我们才能推导目录
      if (artwork.images.length > 0 && artwork.images[0]?.path) {
        const imageRelativePath = artwork.images[0].path

        // 1. 处理路径前缀：移除可能的开头的 '/' 或 '\'
        const cleanRelativePath = imageRelativePath.replace(/^[/\\]/, '')

        // 2. 拼接完整的绝对路径：scanPath + relativePath
        const fullImagePath = path.join(scanPath, cleanRelativePath)

        // 3. 获取目录并拼接 meta 文件名
        const dir = path.dirname(fullImagePath)
        const candidatePath = path.join(dir, `${artwork.externalId}-meta.txt`)

        try {
          // 4. 检查文件是否存在
          await fs.access(candidatePath)

          // 5. 如果存在，记录下相对路径
          const metaSource = path.relative(scanPath, candidatePath).replace(/\\/g, path.posix.sep)
          updates.push(
            prisma.artwork.update({
              where: { id: artwork.id },
              data: { metaSource }
            })
          )
        } catch {
          // 文件不存在，跳过
        }
      }
    }

    if (updates.length > 0) {
      try {
        await prisma.$transaction(updates)
        updatedCount += updates.length
      } catch (error) {
        logger.error('Failed to update batch', { error })
      }
    }

    processedCount += batchIds.length
    const percentage = Math.round((processedCount / totalIds) * 100)

    if (onProgress) {
      await onProgress({
        message: `正在处理... ${processedCount}/${totalIds} (已更新 ${updatedCount})`,
        percentage
      })
    }

    await sleep(10)
  }

  if (onProgress) await onProgress({ message: '完成', percentage: 100 })
  logger.info('Refill meta source task completed', { updatedCount, totalProcessed: totalIds })
  return { updatedCount, totalFiles: totalIds }
}
