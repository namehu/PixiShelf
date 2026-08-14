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

  const canonicalScanPath = await fs.realpath(scanPath)
  const totalIds = await prisma.artwork.count({
    where: {
      metaSource: null,
      externalId: { not: null }
    }
  })
  logger.info(`Found ${totalIds} artworks missing metaSource`)

  if (totalIds === 0) {
    if (onProgress) await onProgress({ message: '没有发现需要补全的作品', percentage: 100 })
    return { updatedCount: 0, totalFiles: 0 }
  }

  let processedCount = 0
  let updatedCount = 0
  const BATCH_SIZE = 50
  let lastSeenId = 0

  while (true) {
    if (checkCancelled && (await checkCancelled())) {
      throw new Error('Task cancelled')
    }

    const artworks = await prisma.artwork.findMany({
      where: {
        id: { gt: lastSeenId },
        metaSource: null,
        externalId: { not: null }
      },
      orderBy: { id: 'asc' },
      take: BATCH_SIZE,
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
    if (artworks.length === 0) break
    lastSeenId = artworks.at(-1)!.id

    const updates = []

    for (const artwork of artworks) {
      if (!artwork.externalId) continue

      // 只有当存在图片时，我们才能推导目录
      if (artwork.images.length > 0 && artwork.images[0]?.path) {
        const imageRelativePath = artwork.images[0].path

        // 1. 处理路径前缀：移除可能的开头的 '/' 或 '\'
        const cleanRelativePath = imageRelativePath.replace(/^[/\\]+/, '')

        // 2. 拼接完整的绝对路径：scanPath + relativePath
        const fullImagePath = path.resolve(canonicalScanPath, cleanRelativePath)
        if (!isPathWithinRoot(canonicalScanPath, fullImagePath)) continue

        // 3. 获取目录并拼接 meta 文件名
        const dir = path.dirname(fullImagePath)
        const metadataFilename = `${artwork.externalId}-meta.txt`
        if (path.basename(metadataFilename) !== metadataFilename || metadataFilename.includes('\0')) continue
        const candidatePath = path.join(dir, metadataFilename)

        try {
          // 4. 检查文件是否存在
          const canonicalCandidate = await fs.realpath(candidatePath)
          if (!isPathWithinRoot(canonicalScanPath, canonicalCandidate)) continue
          const candidateStat = await fs.stat(canonicalCandidate)
          if (!candidateStat.isFile()) continue

          // 5. 如果存在，记录下相对路径
          const metaSource = path.relative(canonicalScanPath, canonicalCandidate).replace(/\\/g, path.posix.sep)
          updates.push(
            prisma.artwork.updateMany({
              where: { id: artwork.id, metaSource: null },
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
        const results = await prisma.$transaction(updates)
        updatedCount += results.reduce((sum, result) => sum + result.count, 0)
      } catch (error) {
        logger.error('Failed to update batch', { error })
      }
    }

    processedCount += artworks.length
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

function isPathWithinRoot(root: string, candidate: string) {
  const relative = path.relative(root, candidate)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}
