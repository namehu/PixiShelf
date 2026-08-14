import path from 'path'
import logger from '@/lib/logger'
import { sleep } from '@/utils/sleep'
import type { ScanResult } from '@/types'
import { batchProcessArtists, batchProcessTags, processBatch } from './batch-processor'
import { globMetadataFiles, parseAndCollect, prepareMetadataFilesFromList } from './metadata-files'
import { formatScanUserError, getRawErrorMessage, isScanCancelledError } from './scan-errors'
import { clearPixivImportedData } from './force-reset'
import type { ArtworkData, GlobMetadataFile, ScanAuditItemInput, ScanContext, ScanOptions } from './types'

/**
 * 统一扫描入口，按配置决定扫描来源、是否全量重扫及失败处理策略。
 *
 * - metadataList 模式：只扫描客户端上报的文件列表，并验证路径是否在 scanPath 内；
 * - forceUpdate 模式：在扫描前清空 Pixiv 入库快照并重建，未成功重建项将失败整个流程；
 * - 运行期错误区分取消与非取消错误，前者返回部分结果，后者向上抛出。
 *
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

    // 强扫必须先验证扫描源，避免空目录、错误路径或临时挂载故障导致旧数据先被删除。
    const metadataFiles = await discoverMetadataFiles(context)

    if (shouldResetPixivImportedData(options)) {
      if (metadataFiles.length === 0) {
        throw new Error('Force scan aborted: no metadata files found')
      }

      options.onProgress?.({
        phase: 'counting',
        message: '正在清理 Pixiv 扫描数据（保留自建和本地导入作品）...',
        percentage: 5
      })

      context.scanResult.removedArtworks = await clearPixivImportedData()

      logger.info('Pixiv imported data cleared for force update', {
        removedArtworks: context.scanResult.removedArtworks
      })

      options.onProgress?.({
        phase: 'counting',
        message: 'Pixiv 扫描数据清理完成，开始重建作品...',
        percentage: 10
      })
    }

    await streamProcessArtworks(context, metadataFiles)

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
    const userError = formatScanUserError(error)
    if (!context.scanResult.errors.includes(userError)) {
      context.scanResult.errors.push(userError)
    }
    context.scanResult.processingTime = Date.now() - startTime

    if (isScanCancelledError(error)) {
      return context.scanResult
    }

    throw error
  } finally {
    logger.info('Scan performance checkpoint:', {
      phase: 'scan_total',
      durationMs: Date.now() - startTime,
      totalArtworks: context.scanResult.totalArtworks,
      skippedArtworks: context.scanResult.skippedArtworks,
      newArtists: context.scanResult.newArtists,
      newArtworks: context.scanResult.newArtworks,
      newImages: context.scanResult.newImages,
      newTags: context.scanResult.newTags,
      errors: context.scanResult.errors.length,
      forceUpdate: !!options.forceUpdate,
      metadataSource: isMetadataListScan(options) ? 'client_list' : 'glob'
    })
  }
}

async function discoverMetadataFiles(context: ScanContext): Promise<GlobMetadataFile[]> {
  const { options } = context
  const source = isMetadataListScan(options) ? 'client_list' : 'glob'

  options.onProgress?.({
    phase: 'counting',
    message: '正在发现作品...',
    percentage: 0
  })
  await sleep(500)

  const discoveryStartTime = Date.now()
  const metadataFiles = isMetadataListScan(options)
    ? await prepareMetadataFilesFromList(options.scanPath, options.metadataRelativePaths!, context, options.forceUpdate)
    : await globMetadataFiles(options.scanPath, context, options.forceUpdate)

  logger.info('Scan performance checkpoint:', {
    phase: 'metadata_discovery',
    durationMs: Date.now() - discoveryStartTime,
    totalFiles: context.scanResult.totalArtworks,
    filesToProcess: metadataFiles.length,
    skippedFiles: context.scanResult.skippedArtworks,
    source,
    forceUpdate: !!options.forceUpdate
  })

  return metadataFiles
}

// 将“发现”与“处理”拼接成单次流式循环，可在批大小可控时降低内存峰值；
// 每批成功才继续推进，Force 重扫下只要存在失败批次则中止以避免状态不一致。
async function streamProcessArtworks(context: ScanContext, metadataFiles: GlobMetadataFile[]): Promise<void> {
  const { options } = context
  const BATCH_SIZE = process.env.NODE_ENV === 'development' ? 5 : 100 // 定义处理批次的大小
  let artworkBatch: ArtworkData[] = []
  let batchNumber = 0
  let basePercentage = shouldResetPixivImportedData(options) ? 10 : 0
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
  const parseCollectStartTime = Date.now()
  let parsedArtworks = 0
  let skippedFiles = 0
  // 2. 遍历文件列表，边发现边处理
  for (let i = 0; i < totalFiles; i++) {
    const metadataFile = metadataFiles[i]
    if (!metadataFile) continue

    // 解析单个文件并收集数据
    const artworkData = await parseAndCollect(metadataFile, context)

    if (artworkData) {
      artworkBatch.push(artworkData)
      parsedArtworks++
    } else {
      skippedFiles++
    }

    // 3. 当批次满员，或者已经是最后一个文件时，触发处理
    if (artworkBatch.length >= BATCH_SIZE || (i === totalFiles - 1 && artworkBatch.length > 0)) {
      // 检查取消状态
      if (options.checkCancelled && (await options.checkCancelled())) {
        throw new Error('Scan cancelled')
      }

      batchNumber++
      logger.info(`Processing batch ${batchNumber} of ${totalBatches} (size: ${artworkBatch.length})...`)
      const batchStartTime = Date.now()
      let fatalBatchError: Error | null = null

      try {
        // 调用批量处理逻辑（针对当前批次的数据）
        await batchProcessTags(artworkBatch, context)
        await batchProcessArtists(artworkBatch, context)
        await processBatch(artworkBatch, context)

        logger.info(`Successfully processed batch ${batchNumber} of ${totalBatches}`)
      } catch (error) {
        logger.error('Failed to process batch:', { error, batchNumber, batchSize: artworkBatch.length })
        const rawErrorMessage = `Failed to process batch ${batchNumber}: ${getRawErrorMessage(error)}`
        context.scanResult.errors.push(formatScanUserError(rawErrorMessage))
        await context.options.audit?.recordItems?.(
          buildFailedWriteAuditItems(artworkBatch, context.options.scanPath, rawErrorMessage)
        )
        if (shouldResetPixivImportedData(options)) {
          fatalBatchError = new Error(rawErrorMessage)
        }
      }
      logger.info('Scan performance checkpoint:', {
        phase: 'batch_processing',
        durationMs: Date.now() - batchStartTime,
        batchNumber,
        batchSize: artworkBatch.length,
        totalBatches,
        processedFiles: i + 1,
        totalFiles,
        errors: context.scanResult.errors.length
      })

      if (fatalBatchError) {
        throw fatalBatchError
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

  logger.info('Scan performance checkpoint:', {
    phase: 'metadata_parse_collect',
    durationMs: Date.now() - parseCollectStartTime,
    totalFiles,
    parsedArtworks,
    skippedFiles
  })

  if (shouldResetPixivImportedData(options) && skippedFiles > 0) {
    throw new Error(`Force scan failed to rebuild ${skippedFiles} of ${totalFiles} discovered artworks`)
  }
}

function buildFailedWriteAuditItems(
  batch: ArtworkData[],
  scanPath: string,
  errorMessage: string
): ScanAuditItemInput[] {
  const finishedAt = new Date()
  return batch.map((artworkData) => ({
    externalId: artworkData.metadata.id,
    title: artworkData.metadata.title,
    artistName: artworkData.metadata.user,
    relativeDirectory: toRelativeScanPath(scanPath, artworkData.directoryPath),
    metadataRelativePath: toRelativeScanPath(scanPath, artworkData.metadataFilePath),
    status: 'FAILED',
    action: 'FAILED_WRITE',
    mediaCount: artworkData.mediaFiles.length,
    errorMessage,
    finishedAt
  }))
}

function toRelativeScanPath(scanPath: string, targetPath: string): string {
  return path.relative(scanPath, targetPath).replace(/\\/g, '/')
}

function shouldResetPixivImportedData(options: ScanOptions): boolean {
  return options.forceUpdate === true && !isMetadataListScan(options)
}

function isMetadataListScan(options: ScanOptions): boolean {
  return options.metadataRelativePaths !== undefined
}
