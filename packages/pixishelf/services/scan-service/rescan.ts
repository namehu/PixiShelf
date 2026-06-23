import path from 'path'
import fg from 'fast-glob'
import logger from '@/lib/logger'
import type { ScanResult } from '@/types'
import { scanLocalArtworkMediaDirectory } from '@/services/artwork-service/local-media-scanner'
import { updateArtworkImagesTransaction } from '@/services/artwork-service/image-manager'
import { extractArtworkIdFromFilename } from './metadata-parser'
import { getMetadataFormatFromFilename, selectPreferredMetadataFiles } from './metadata-candidates'
import { batchProcessArtists, processRescanBatch } from './batch-processor'
import { parseAndCollect } from './metadata-files'
import type { GlobMetadataFile, ScanContext, ScanOptions } from './types'

/**
 * 重新扫描单个作品
 * @param options 扫描选项
 * @param artworkId 目标作品ID
 * @param targetDirectoryRelativePath 目标作品目录的相对路径
 */
export async function rescanArtwork(
  options: ScanOptions,
  artworkId: string,
  targetDirectoryRelativePath: string
): Promise<ScanResult> {
  const startTime = Date.now()
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
    logger.info('Starting rescan for artwork:', { artworkId, targetDirectoryRelativePath })

    // 1. 构造目标目录的绝对路径
    // 如果 targetDirectoryRelativePath 为空或 "."，则扫描根目录
    // 移除开头的斜杠
    const cleanPath = targetDirectoryRelativePath.startsWith('/')
      ? targetDirectoryRelativePath.slice(1)
      : targetDirectoryRelativePath
    const targetDir = path.resolve(options.scanPath, cleanPath)

    options.onProgress?.({
      phase: 'scanning',
      message: `正在扫描目录: ${cleanPath}`,
      percentage: 10
    })

    // 2. 查找元数据文件
    // 支持标准 ID-meta.{json,txt} 和 Pixiv 分页导出的 ID_p0-meta.{json,txt}。
    const files = await fg([`${artworkId}*-meta.{json,txt}`], {
      cwd: targetDir,
      absolute: true,
      deep: 1, // 仅在当前目录查找，不递归
      onlyFiles: true
    })
    const matchedFiles = files
      .map((file) => {
        const name = path.basename(file)
        const metadataFormat = getMetadataFormatFromFilename(name)
        return {
          name,
          artworkId: extractArtworkIdFromFilename(name) || '',
          path: file,
          createdAt: new Date(),
          metadataFormat
        }
      })
      .filter(
        (file): file is GlobMetadataFile =>
          file.artworkId === artworkId && file.metadataFormat !== null && file.metadataFormat !== undefined
      )

    if (matchedFiles.length <= 0) {
      throw new Error(`在目录 "${cleanPath}" 中未找到作品 ${artworkId} 的元数据文件`)
    }

    const _file = selectPreferredMetadataFiles(matchedFiles, (message) => {
      context.scanResult.errors.push(message)
      logger.warn('Duplicate artworkId found during rescan:', { message })
    })[0]!
    const metadataFile: GlobMetadataFile = {
      name: path.basename(_file.path),
      artworkId: artworkId,
      path: _file.path,
      createdAt: new Date(),
      metadataFormat: _file.metadataFormat
    }

    context.scanResult.totalArtworks = 1

    options.onProgress?.({
      phase: 'scanning',
      message: '正在解析元数据...',
      percentage: 30
    })

    // 3. 解析元数据
    const artworkData = await parseAndCollect(metadataFile)
    if (!artworkData) {
      throw new Error('元数据文件解析失败或媒体文件缺失')
    }

    options.onProgress?.({
      phase: 'counting',
      message: '正在更新数据...',
      percentage: 50
    })

    // 4. 预处理 Artist (填充缓存)
    // 注意：重新扫描逻辑不再更新 Tag，因此无需 batchProcessTags
    await batchProcessArtists([artworkData], context)

    // 5. 执行更新
    await processRescanBatch([artworkData], context)

    options.onProgress?.({
      phase: 'complete',
      message: '重新扫描完成',
      percentage: 100
    })
  } catch (error) {
    logger.error('Rescan failed:', { error, artworkId })
    context.scanResult.errors.push(error instanceof Error ? error.message : 'Unknown error')
    // 重新抛出以便上层处理（虽然 scan 方法通常吞掉错误返回 result，但这里是单次操作，抛出可能更合适？
    // 为了保持一致性，我们还是返回 result，但 result 里有 errors）
  }

  context.scanResult.processingTime = Date.now() - startTime
  return context.scanResult
}

/**
 * 重新扫描本地创建作品的媒体目录。
 * 不读取 Pixiv 元数据文件，也不覆盖用户维护的标题、作者、描述和标签。
 */
export async function rescanLocalArtwork(
  options: ScanOptions,
  artworkId: number,
  targetDirectoryRelativePath: string
): Promise<ScanResult> {
  const startTime = Date.now()
  const scanResult: ScanResult = {
    totalArtworks: 1,
    newArtists: 0,
    newArtworks: 0,
    newImages: 0,
    newTags: 0,
    skippedArtworks: 0,
    errors: [],
    processingTime: 0,
    removedArtworks: 0
  }

  try {
    logger.info('Starting local artwork rescan:', { artworkId, targetDirectoryRelativePath })

    options.onProgress?.({
      phase: 'scanning',
      message: '正在扫描本地作品媒体文件...',
      percentage: 20
    })

    const mediaScanResult = await scanLocalArtworkMediaDirectory({
      scanPath: options.scanPath,
      targetDirectoryRelativePath,
      checkCancelled: options.checkCancelled,
      onProgress: ({ current, total, fileName }) => {
        const percentage = total > 0 ? 20 + Math.round((current / total) * 50) : 20
        options.onProgress?.({
          phase: 'scanning',
          message: `正在扫描本地媒体文件 ${current}/${total}: ${fileName}`,
          current,
          total,
          percentage
        })
      }
    })

    scanResult.errors.push(...mediaScanResult.warnings)

    if (mediaScanResult.filesMeta.length === 0) {
      throw new Error(`在目录 "${targetDirectoryRelativePath}" 中未找到媒体文件`)
    }

    options.onProgress?.({
      phase: 'counting',
      message: '正在更新媒体与章节信息...',
      percentage: 70
    })

    await updateArtworkImagesTransaction(artworkId, mediaScanResult.filesMeta, mediaScanResult.chaptersMeta)
    scanResult.newImages = mediaScanResult.filesMeta.length
    scanResult.newArtworks = 1

    options.onProgress?.({
      phase: 'complete',
      message: '本地作品重新扫描完成',
      percentage: 100
    })
  } catch (error) {
    logger.error('Local artwork rescan failed:', { error, artworkId })
    scanResult.errors.push(error instanceof Error ? error.message : 'Unknown error')
  }

  scanResult.processingTime = Date.now() - startTime
  return scanResult
}
