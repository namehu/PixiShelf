import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { sleep } from '@/utils/sleep'
import type { ScanResult } from '@/types'
import { batchProcessArtists, batchProcessTags, processBatch } from './batch-processor'
import { globMetadataFiles, parseAndCollect, prepareMetadataFilesFromList } from './metadata-files'
import type { ArtworkData, ScanContext, ScanOptions } from './types'

/**
 * 扫描方法
 * @param options 扫描选项
 * @returns 扫描结果
 */
export async function scan(options: ScanOptions): Promise<ScanResult> {
  const startTime = Date.now()

  // 初始化上下文
  const context: ScanContext = {
    tagCache: new Map(),
    artistCache: new Map(),
    scanResult: {
      totalArtworks: 0,
      newArtists: 0,
      newArtworks: 0,
      newImages: 0,
      newTags: 0,
      skippedArtworks: 0,
      errors: [],
      processingTime: 0,
      removedArtworks: 0
    },
    options
  }

  try {
    logger.info('Starting scan:', { scanPath: options.scanPath })

    // 如果是强制更新，先清空数据库（10%权重）
    if (options.forceUpdate) {
      options.onProgress?.({
        phase: 'counting',
        message: '正在清空数据库...',
        percentage: 0
      })

      await clearDatabase()

      logger.info('Database cleared for force update')

      options.onProgress?.({
        phase: 'counting',
        message: '数据库清空完成，开始发现作品...',
        percentage: 10
      })
    }

    // 直接调用流式处理方法，取代原来的发现+处理模式
    await streamProcessArtworks(context)

    // 最终完成
    options.onProgress?.({
      phase: 'complete',
      message: '扫描完成',
      percentage: 100
    })

    context.scanResult.processingTime = Date.now() - startTime

    logger.info('Scan completed:', {
      result: context.scanResult,
      processingTimeMs: context.scanResult.processingTime
    })

    return context.scanResult
  } catch (error) {
    logger.error('Scan failed:', { error, options })
    context.scanResult.errors.push(error instanceof Error ? error.message : 'Unknown error')
    context.scanResult.processingTime = Date.now() - startTime
    return context.scanResult
  }
}

/**
 * 流式处理作品，取代原来的发现+处理模式
 * 边发现边处理，降低内存峰值
 * @param context 扫描上下文
 */
async function streamProcessArtworks(context: ScanContext): Promise<void> {
  const { options } = context
  const BATCH_SIZE = process.env.NODE_ENV === 'development' ? 5 : 100 // 定义处理批次的大小
  let artworkBatch: ArtworkData[] = []
  let batchNumber = 0
  let basePercentage = options.forceUpdate ? 10 : 0

  options.onProgress?.({
    phase: 'counting',
    message: '正在发现作品...',
    percentage: basePercentage
  })
  await sleep(500)
  // 根据是否提供客户端元数据列表选择来源
  const metadataFiles = !options.metadataRelativePaths?.length
    ? await globMetadataFiles(options.scanPath, context, options.forceUpdate)
    : await prepareMetadataFilesFromList(options.scanPath, options.metadataRelativePaths, context, options.forceUpdate)
  const totalFiles = metadataFiles.length
  const totalBatches = Math.ceil(totalFiles / BATCH_SIZE)

  if (totalFiles === 0) {
    options.onProgress?.({
      phase: 'complete',
      message: '未发现任何作品',
      percentage: 100
    })
    return
  }

  basePercentage += 10
  options.onProgress?.({
    phase: 'scanning',
    message: `发现 ${totalFiles} 个作品，开始处理...`,
    current: 0,
    total: totalFiles,
    percentage: basePercentage
  })

  await sleep(100)
  // 2. 遍历文件列表，边发现边处理
  for (let i = 0; i < totalFiles; i++) {
    const metadataFile = metadataFiles[i]
    if (!metadataFile) continue

    // 解析单个文件并收集数据
    const artworkData = await parseAndCollect(metadataFile)

    if (artworkData) {
      artworkBatch.push(artworkData)
    }

    // 3. 当批次满员，或者已经是最后一个文件时，触发处理
    if (artworkBatch.length >= BATCH_SIZE || (i === totalFiles - 1 && artworkBatch.length > 0)) {
      // 检查取消状态
      if (options.checkCancelled && (await options.checkCancelled())) {
        throw new Error('Scan cancelled')
      }

      batchNumber++
      logger.info(`Processing batch ${batchNumber} of ${totalBatches} (size: ${artworkBatch.length})...`)

      try {
        // 调用批量处理逻辑（针对当前批次的数据）
        await batchProcessTags(artworkBatch, context)
        await batchProcessArtists(artworkBatch, context)
        await processBatch(artworkBatch, context)

        logger.info(`Successfully processed batch ${batchNumber} of ${totalBatches}`)
      } catch (error) {
        logger.error('Failed to process batch:', { error, batchNumber, batchSize: artworkBatch.length })
        context.scanResult.errors.push(
          `Failed to process batch ${batchNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }

      // 清空批次，为下一批做准备
      artworkBatch = []

      // 更新总进度（70%权重：10%-80%）
      const progressPercentage = ((i + 1) / totalFiles) * 70
      options.onProgress?.({
        phase: 'scanning',
        message: `已处理 ${i + 1}/${totalFiles} 个作品`,
        current: i + 1,
        total: totalFiles,
        percentage: Math.round(basePercentage + progressPercentage)
      })
      await sleep(100)
    }
  }
}

/**
 * 清空数据库（保留 user 和 setting 表）
 * 用于强制全量扫描时清空所有艺术相关数据
 * 使用 TRUNCATE 提供更高的性能
 */
async function clearDatabase(): Promise<void> {
  try {
    logger.info('Starting database cleanup with TRUNCATE for force update')

    // 使用 TRUNCATE 一次性清空所有艺术相关表
    // RESTART IDENTITY 会重置自增ID，CASCADE 会处理外键依赖
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "ArtworkTag", "Image", "Artwork", "Artist", "Tag" RESTART IDENTITY CASCADE;'
    )

    logger.info('Database cleanup with TRUNCATE completed successfully')
  } catch (error) {
    logger.error('Failed to clear database with TRUNCATE:', { error })
    throw new Error(`Database cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}
