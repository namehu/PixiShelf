import path from 'path'
import fg from 'fast-glob'
import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { parseMetadataFile, extractArtworkIdFromFilename } from './metadata-parser'
import { collectMediaFiles } from './media-collector'
import { getMetadataFormatFromFilename, selectPreferredMetadataFiles } from './metadata-candidates'
import { formatInvalidMetadataPathError } from './scan-errors'
import type { ArtworkData, GlobMetadataFile, ScanAuditItemInput, ScanContext } from './types'

/**
 * 递归查找元数据文件
 * @param directoryPath 目录路径
 * @param context 扫描上下文
 * @param forceUpdate 是否强制更新
 * @returns 元数据文件数组
 */
export async function globMetadataFiles(
  directoryPath: string,
  context: ScanContext,
  forceUpdate: boolean = false
): Promise<GlobMetadataFile[]> {
  let files: string[] = []

  logger.info('Using local file scanning for metadata file discovery', {
    directoryPath
  })

  // 使用本地文件扫描
  files = await fg(['**/*-meta.{txt,json}'], {
    cwd: path.resolve(directoryPath),
    deep: 4,
    absolute: true,
    onlyFiles: true
  })

  const createdAt = new Date()
  // 过滤出符合 数字-meta.txt 格式的文件
  const validFiles = files
    .map((file) => {
      const name = path.basename(file)
      const metadataFormat = getMetadataFormatFromFilename(name)
      return {
        name,
        createdAt,
        artworkId: extractArtworkIdFromFilename(name)!,
        path: file,
        metadataFormat
      }
    })
    .filter((file): file is GlobMetadataFile => !!file.artworkId && !!file.metadataFormat)

  const preferredFiles = selectPreferredMetadataFiles(validFiles, (message) => {
    context.scanResult.errors.push(message)
    logger.warn('Duplicate artworkId found:', { message })
  })

  context.scanResult.totalArtworks = preferredFiles.length // 发现总作品数

  // 如果不是强制更新，需要过滤掉已存在的作品
  let filesToProcess = preferredFiles
  if (!forceUpdate) {
    const artworkIds = preferredFiles.map(({ artworkId }) => artworkId) // 提取所有作品的 artworkId

    if (artworkIds.length > 0) {
      // 查询数据库中已存在的 externalId
      const existingArtworks = await prisma.artwork.findMany({
        where: {
          externalId: {
            in: artworkIds
          }
        },
        select: {
          externalId: true
        }
      })

      const existingIds = new Set(existingArtworks.map((artwork) => artwork.externalId))

      // 过滤掉已存在的文件
      filesToProcess = preferredFiles.filter((file) => !existingIds.has(file.artworkId))

      context.scanResult.skippedArtworks = preferredFiles.length - filesToProcess.length // 已存在作品数

      logger.info('Filtered metadata files based on existing artworks:', {
        totalFiles: preferredFiles.length,
        existingFiles: preferredFiles.length - filesToProcess.length,
        filesToProcess: filesToProcess.length
      })
    }
  }

  return filesToProcess
}

/**
 * 基于客户端提供的相对路径列表构建元数据文件集合
 * @param directoryPath 目录根路径（scanPath）
 * @param relativePaths 客户端提供的相对路径列表
 * @param context 扫描上下文
 * @param forceUpdate 是否强制更新（影响去重与过滤）
 */
export async function prepareMetadataFilesFromList(
  directoryPath: string,
  relativePaths: string[],
  context: ScanContext,
  forceUpdate: boolean = false
): Promise<GlobMetadataFile[]> {
  logger.info('Building metadata files from client-provided list', {
    directoryPath,
    count: relativePaths.length
  })

  const createdAt = new Date()
  const scanRootPath = path.resolve(directoryPath)
  const scanRootPrefix = `${scanRootPath}${path.sep}`
  const files = relativePaths
    .map((relativePath) => {
      const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
      const absolutePath = path.resolve(scanRootPath, cleanPath)
      const isInsideScanPath = absolutePath === scanRootPath || absolutePath.startsWith(scanRootPrefix)

      if (!isInsideScanPath) {
        context.scanResult.errors.push(formatInvalidMetadataPathError(relativePath))
        logger.warn('Invalid metadata path out of scan root', {
          scanRootPath,
          relativePath,
          absolutePath
        })
        return null
      }

      const name = path.basename(absolutePath)
      const metadataFormat = getMetadataFormatFromFilename(name)
      const artworkId = extractArtworkIdFromFilename(name) || ''
      return {
        name,
        artworkId,
        path: absolutePath,
        createdAt,
        metadataFormat
      } as GlobMetadataFile
    })
    .filter((file): file is GlobMetadataFile => file !== null)

  // 过滤掉未能解析出作品ID的项
  const validFiles = files.filter((file) => !!file.artworkId && !!file.metadataFormat)
  const preferredFiles = selectPreferredMetadataFiles(validFiles, (message) => {
    context.scanResult.errors.push(message)
    logger.warn('Duplicate artworkId found:', { message })
  })
  context.scanResult.totalArtworks = preferredFiles.length

  // 非强制更新时，过滤掉数据库中已存在的作品
  let filesToProcess = preferredFiles
  if (!forceUpdate) {
    const artworkIds = preferredFiles.map(({ artworkId }) => artworkId)
    if (artworkIds.length > 0) {
      const existingArtworks = await prisma.artwork.findMany({
        where: { externalId: { in: artworkIds } },
        select: { externalId: true }
      })

      const existingIds = new Set(existingArtworks.map((a) => a.externalId))
      filesToProcess = preferredFiles.filter((file) => !existingIds.has(file.artworkId))
      context.scanResult.skippedArtworks = preferredFiles.length - filesToProcess.length

      logger.info('Filtered client list based on existing artworks', {
        totalFiles: preferredFiles.length,
        existingFiles: preferredFiles.length - filesToProcess.length,
        filesToProcess: filesToProcess.length
      })
    }
  }

  return filesToProcess
}

/**
 * 解析单个元数据文件并收集媒体文件
 * @param metadataFile 元数据文件信息
 * @returns 作品数据或null
 */
export async function parseAndCollect(metadataFile: GlobMetadataFile, context?: ScanContext): Promise<ArtworkData | null> {
  const { artworkId, path: metadataPath, name: metadataFilename, createdAt } = metadataFile
  const startedAt = new Date()

  if (!artworkId) {
    logger.warn('Invalid metadata filename:', { metadataFilename })
    await recordAuditItem(context, {
      externalId: null,
      metadataRelativePath: metadataFilename,
      status: 'SKIPPED',
      action: 'SKIP_INVALID_METADATA',
      errorMessage: '无法从 metadata 文件名解析作品 ID',
      startedAt,
      finishedAt: new Date()
    })
    return null
  }

  try {
    // 解析元数据
    const parseResult = await parseMetadataFile(metadataPath)
    if (!parseResult.success || !parseResult.metadata) {
      // 区分文件丢失和其他解析错误
      if (parseResult.error && parseResult.error.startsWith('File not found')) {
        // 文件丢失通常是由于在扫描过程中文件被移动或删除，属于预期内的边缘情况
        logger.warn(`Skipping artwork due to missing metadata file: ${metadataPath}`)
      } else {
        logger.warn('Failed to parse metadata:', { metadataPath, error: parseResult.error })
      }
      await recordAuditItem(context, {
        externalId: artworkId,
        metadataRelativePath: toRelativeScanPath(context?.options.scanPath, metadataPath),
        relativeDirectory: toRelativeScanPath(context?.options.scanPath, path.dirname(metadataPath)),
        status: 'FAILED',
        action: 'FAILED_PARSE',
        errorMessage: parseResult.error ?? '解析 metadata 失败',
        startedAt,
        finishedAt: new Date()
      })
      return null
    }

    // 收集媒体文件
    const collectionResult = await collectMediaFiles(path.dirname(metadataPath), artworkId)
    if (!collectionResult.success) {
      logger.warn('Failed to collect media files:', { metadataPath, artworkId, error: collectionResult.error })
      await recordAuditItem(context, {
        externalId: artworkId,
        title: parseResult.metadata.title,
        artistName: parseResult.metadata.user,
        metadataRelativePath: toRelativeScanPath(context?.options.scanPath, metadataPath),
        relativeDirectory: toRelativeScanPath(context?.options.scanPath, path.dirname(metadataPath)),
        status: 'FAILED',
        action: 'FAILED_COLLECT',
        errorMessage: collectionResult.error ?? '收集媒体文件失败',
        startedAt,
        finishedAt: new Date()
      })
      return null
    }

    if (collectionResult.mediaFiles.length === 0) {
      logger.warn('No media files found for artwork:', { metadataPath, artworkId })
      await recordAuditItem(context, {
        externalId: artworkId,
        title: parseResult.metadata.title,
        artistName: parseResult.metadata.user,
        metadataRelativePath: toRelativeScanPath(context?.options.scanPath, metadataPath),
        relativeDirectory: toRelativeScanPath(context?.options.scanPath, path.dirname(metadataPath)),
        status: 'SKIPPED',
        action: 'SKIP_NO_MEDIA',
        errorMessage: '未发现可导入的媒体文件',
        startedAt,
        finishedAt: new Date()
      })
      return null
    }

    return {
      metadata: parseResult.metadata,
      mediaFiles: collectionResult.mediaFiles,
      directoryPath: path.dirname(metadataPath),
      metadataFilePath: metadataPath,
      directoryCreatedAt: createdAt
    }
  } catch (error) {
    logger.error('Error processing metadata file:', { error, metadataPath })
    await recordAuditItem(context, {
      externalId: artworkId,
      metadataRelativePath: toRelativeScanPath(context?.options.scanPath, metadataPath),
      relativeDirectory: toRelativeScanPath(context?.options.scanPath, path.dirname(metadataPath)),
      status: 'FAILED',
      action: 'FAILED_PARSE',
      errorMessage: error instanceof Error ? error.message : '处理 metadata 文件失败',
      startedAt,
      finishedAt: new Date()
    })
    return null
  }
}

function toRelativeScanPath(scanPath: string | undefined, targetPath: string): string {
  if (!scanPath) return targetPath.replace(/\\/g, '/')
  return path.relative(scanPath, targetPath).replace(/\\/g, '/')
}

async function recordAuditItem(context: ScanContext | undefined, item: ScanAuditItemInput) {
  await context?.options.audit?.recordItems?.([item])
}
