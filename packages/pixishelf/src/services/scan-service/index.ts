// oxlint-disable max-lines
import path from 'path'
import fg from 'fast-glob'
import { prisma } from '@/lib/prisma'
import logger from '@/lib/logger'
import { sleep } from '@/utils/sleep'
import { ScanProgress, ScanResult } from '@/types'
import { parseMetadataFile, MetadataInfo, extractArtworkIdFromFilename } from './metadata-parser'
import { collectMediaFiles, MediaFileInfo } from './media-collector'

/**
 * 扫描选项接口
 */
export interface ScanOptions {
  scanPath: string
  forceUpdate?: boolean
  onProgress?: (progress: ScanProgress) => void
  /**
   * 检查取消状态的回调函数
   * 如果返回 true，则扫描过程应立即终止并抛出取消异常
   */
  checkCancelled?: () => Promise<boolean>
  /**
   * 客户端传入的元数据相对路径列表（相对 scanPath）
   * 如果提供，则不进行本地/远程文件扫描，而是直接基于该列表构建元数据文件集合
   */
  metadataRelativePaths?: string[]
}

/**
 * 作品数据接口
 */
interface ArtworkData {
  metadata: MetadataInfo
  mediaFiles: MediaFileInfo[]
  directoryPath: string
  metadataFilePath: string
  directoryCreatedAt: Date
}

interface GlobMetadataFile {
  name: string
  artworkId: string
  path: string
  createdAt: Date
}

/**
 * 扫描上下文接口
 */
interface ScanContext {
  tagCache: Map<string, number>
  artistCache: Map<string, any>
  scanResult: ScanResult
  options: ScanOptions
}

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
 * 递归查找元数据文件
 * @param directoryPath 目录路径
 * @param context 扫描上下文
 * @param forceUpdate 是否强制更新
 * @returns 元数据文件数组
 */
async function globMetadataFiles(
  directoryPath: string,
  context: ScanContext,
  forceUpdate: boolean = false
): Promise<GlobMetadataFile[]> {
  const useRemoteScanner = process.env.USE_REMOTE_SCANNER === 'true'
  let files: string[] = []

  if (useRemoteScanner) {
    try {
      logger.info('Using remote scanner service for metadata file discovery', {
        directoryPath,
        useRemoteScanner
      })

      // 调用远程扫描服务
      const remoteFiles = await callRemoteScannerService(directoryPath)

      // 远程服务返回的是相对路径（去掉了 SCAN_DIRECTORY 前缀）
      // 需要拼接 directoryPath 来生成绝对路径
      files = remoteFiles.map((relativePath) => {
        // 移除开头的斜杠（如果有的话）
        const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
        return path.resolve(directoryPath, cleanPath)
      })

      logger.info('Successfully processed remote scanner results', {
        remoteFileCount: remoteFiles.length,
        processedFileCount: files.length,
        samplePaths: files.slice(0, 3) // 记录前3个路径作为示例
      })
    } catch (error) {
      logger.error('Failed to use remote scanner service, falling back to local scanning', {
        error: error instanceof Error ? error.message : 'Unknown error',
        directoryPath
      })

      // 远程服务失败时回退到本地扫描
      files = await fg(['**/*-meta.txt'], {
        cwd: path.resolve(directoryPath),
        deep: 4,
        absolute: true,
        onlyFiles: true
      })
    }
  } else {
    logger.info('Using local file scanning for metadata file discovery', {
      directoryPath,
      useRemoteScanner
    })

    // 使用本地文件扫描
    files = await fg(['**/*-meta.txt'], {
      cwd: path.resolve(directoryPath),
      deep: 4,
      absolute: true,
      onlyFiles: true
    })
  }

  const createdAt = new Date()
  // 过滤出符合 数字-meta.txt 格式的文件
  const validFiles = files
    .map((file) => {
      const name = path.basename(file)
      return {
        name,
        createdAt,
        artworkId: extractArtworkIdFromFilename(name)!,
        path: file
      }
    })
    .filter((file) => !!file.artworkId)

  context.scanResult.totalArtworks = validFiles.length // 发现总作品数

  // 如果不是强制更新，需要过滤掉已存在的作品
  let filesToProcess = validFiles
  if (!forceUpdate) {
    const artworkIds = validFiles.map(({ artworkId }) => artworkId) // 提取所有文件的 artworkId

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
      filesToProcess = validFiles.filter((file) => !existingIds.has(file.artworkId))

      context.scanResult.skippedArtworks = validFiles.length - filesToProcess.length // 已存在作品数

      logger.info('Filtered metadata files based on existing artworks:', {
        totalFiles: validFiles.length,
        existingFiles: validFiles.length - filesToProcess.length,
        filesToProcess: filesToProcess.length
      })
    }
  }

  // filesToProcess 中如果artworkId 有重复的 则保留一个并发生成错误日志信息
  const artworkIdSet: Record<string, GlobMetadataFile> = {}
  filesToProcess = filesToProcess.filter((file: any) => {
    const existingFile = artworkIdSet[file.artworkId]
    if (existingFile) {
      context.scanResult.errors.push(
        `Duplicate artworkId found: ${file.artworkId}\n ${existingFile.path} \n ${file.path}`
      )
      logger.warn('Duplicate artworkId found:', { artworkId: file.artworkId })
      return false
    }
    artworkIdSet[file.artworkId] = file
    return true
  })

  return filesToProcess
}

/**
 * 基于客户端提供的相对路径列表构建元数据文件集合
 * @param directoryPath 目录根路径（scanPath）
 * @param relativePaths 客户端提供的相对路径列表
 * @param context 扫描上下文
 * @param forceUpdate 是否强制更新（影响去重与过滤）
 */
async function prepareMetadataFilesFromList(
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
  // 拼接为绝对路径并构建基础元数据文件对象
  const files = relativePaths.map((relativePath) => {
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
    const absolutePath = path.resolve(directoryPath, cleanPath)
    const name = path.basename(absolutePath)
    const artworkId = extractArtworkIdFromFilename(name) || ''
    return {
      name,
      artworkId,
      path: absolutePath,
      createdAt
    } as GlobMetadataFile
  })

  // 过滤掉未能解析出作品ID的项
  const validFiles = files.filter((file) => !!file.artworkId)
  context.scanResult.totalArtworks = validFiles.length

  // 非强制更新时，过滤掉数据库中已存在的作品
  let filesToProcess = validFiles
  if (!forceUpdate) {
    const artworkIds = validFiles.map(({ artworkId }) => artworkId)
    if (artworkIds.length > 0) {
      const existingArtworks = await prisma.artwork.findMany({
        where: { externalId: { in: artworkIds } },
        select: { externalId: true }
      })

      const existingIds = new Set(existingArtworks.map((a) => a.externalId))
      filesToProcess = validFiles.filter((file) => !existingIds.has(file.artworkId))
      context.scanResult.skippedArtworks = validFiles.length - filesToProcess.length

      logger.info('Filtered client list based on existing artworks', {
        totalFiles: validFiles.length,
        existingFiles: validFiles.length - filesToProcess.length,
        filesToProcess: filesToProcess.length
      })
    }
  }

  // artworkId 去重，保留一个并记录错误
  const artworkIdSet: Record<string, GlobMetadataFile> = {}
  filesToProcess = filesToProcess.filter((file: any) => {
    const existingFile = artworkIdSet[file.artworkId]
    if (existingFile) {
      context.scanResult.errors.push(
        `Duplicate artworkId found: ${file.artworkId}\n ${existingFile.path} \n ${file.path}`
      )
      logger.warn('Duplicate artworkId found:', { artworkId: file.artworkId })
      return false
    }
    artworkIdSet[file.artworkId] = file
    return true
  })

  return filesToProcess
}

/**
 * 解析单个元数据文件并收集媒体文件
 * @param metadataFile 元数据文件信息
 * @returns 作品数据或null
 */
async function parseAndCollect(metadataFile: GlobMetadataFile): Promise<ArtworkData | null> {
  const { artworkId, path: metadataPath, name: metadataFilename, createdAt } = metadataFile

  if (!artworkId) {
    logger.warn('Invalid metadata filename:', { metadataFilename })
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
      return null
    }

    // 收集媒体文件
    const collectionResult = await collectMediaFiles(path.dirname(metadataPath), artworkId)
    if (!collectionResult.success) {
      logger.warn('Failed to collect media files:', { metadataPath, artworkId, error: collectionResult.error })
      return null
    }

    if (collectionResult.mediaFiles.length === 0) {
      logger.warn('No media files found for artwork:', { metadataPath, artworkId })
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
    return null
  }
}

/**
 * 批量处理一个批次的作品（使用事务）
 * @param batch 批次作品数组
 * @param context 扫描上下文
 */
async function processBatch(batch: ArtworkData[], context: ScanContext): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      // 准备批量数据
      const artworksToCreate = []
      const imagesToCreate = []
      const artworkTagsToCreate = []

      for (const artworkData of batch) {
        const { metadata, directoryCreatedAt, metadataFilePath } = artworkData

        // 从缓存获取艺术家
        const artist = context.artistCache.get(metadata.userId)
        if (!artist) {
          logger.warn('Artist not found in cache, this should not happen after batch processing:', {
            userId: metadata.userId
          })
          continue
        }

        // 准备作品数据
        const artworkToCreate = {
          title: metadata.title,
          description: metadata.description || null,
          artistId: artist.id,
          imageCount: 0, // 初始为 0，由 DB 触发器在插入图片时自动增加
          descriptionLength: metadata.description?.length || 0,
          externalId: metadata.id,
          metaSource: getMetaSource(metadataFilePath, context.options.scanPath),
          sourceUrl: metadata.url || null,
          originalUrl: metadata.original || null,
          thumbnailUrl: metadata.thumbnail || null,
          xRestrict: metadata.xRestrict || null,
          isAiGenerated: metadata.ai === 'Yes',
          size: metadata.size || null,
          bookmarkCount: metadata.bookmark || null,
          sourceDate: metadata.date || null,
          directoryCreatedAt
        }

        artworksToCreate.push(artworkToCreate)
      }

      // 批量创建作品
      if (artworksToCreate.length > 0) {
        // 使用 createMany 而不是 createManyAndReturn 来提高性能
        await tx.artwork.createMany({
          data: artworksToCreate,
          skipDuplicates: true
        })

        context.scanResult.newArtworks += artworksToCreate.length

        // 查询刚创建的作品以获取 ID（通过 externalId 匹配）
        const externalIds = artworksToCreate.map((a) => a.externalId)
        const createdArtworks = await tx.artwork.findMany({
          where: {
            externalId: {
              in: externalIds
            }
          },
          orderBy: {
            id: 'asc'
          }
        })

        // 创建 externalId 到 artwork 的映射
        const artworkMap = new Map()
        for (const artwork of createdArtworks) {
          artworkMap.set(artwork.externalId, artwork)
        }

        // 为每个作品准备图片和标签数据
        for (const artworkData of batch) {
          const artwork = artworkMap.get(artworkData.metadata.id)
          if (!artwork) continue

          // 准备图片数据
          if (artworkData.mediaFiles.length > 0) {
            const artworkImages = artworkData.mediaFiles.map((mediaFile) => ({
              path: getRelativePath(mediaFile.path, context.options.scanPath),
              size: mediaFile.size,
              sortOrder: mediaFile.sortOrder,
              artworkId: artwork.id
            }))
            imagesToCreate.push(...artworkImages)
          }

          // 准备标签关联数据
          if (artworkData.metadata.tags && artworkData.metadata.tags.length > 0) {
            for (const tagName of artworkData.metadata.tags) {
              if (!tagName) continue

              const tagId = context.tagCache.get(tagName)
              if (tagId) {
                artworkTagsToCreate.push({
                  artworkId: artwork.id,
                  tagId
                })
              }
            }
          }
        }

        // 批量创建图片
        if (imagesToCreate.length > 0) {
          await tx.image.createMany({
            data: imagesToCreate,
            skipDuplicates: true
          })
          context.scanResult.newImages += imagesToCreate.length
        }

        // 批量创建作品-标签关联
        if (artworkTagsToCreate.length > 0) {
          await tx.artworkTag.createMany({
            data: artworkTagsToCreate,
            skipDuplicates: true
          })
        }
      }
    },
    {
      timeout: 30000, // 增加事务超时时间到 30 秒
      maxWait: 5000 // 最大等待时间 5 秒
    }
  )
}

/**
 * 批量预处理当前批次作品的艺术家（增量处理）
 * @param artworks 作品数组
 * @param context 扫描上下文
 */
async function batchProcessArtists(artworks: ArtworkData[], context: ScanContext): Promise<void> {
  // 1. 收集当前批次中缓存中不存在的艺术家用户ID
  const uncachedUserIds = new Set<string>()
  for (const artwork of artworks) {
    if (artwork.metadata.userId && !context.artistCache.has(artwork.metadata.userId)) {
      uncachedUserIds.add(artwork.metadata.userId)
    }
  }

  if (uncachedUserIds.size === 0) {
    logger.info('All artists in current batch are already cached, skipping artist processing')
    return
  }

  logger.info('Processing uncached artists in current batch:', { uncachedArtists: uncachedUserIds.size })

  // 2. 批量查询数据库中已存在的艺术家
  const existingArtists = await prisma.artist.findMany({
    where: {
      userId: {
        in: Array.from(uncachedUserIds)
      }
    }
  })

  // 构建已存在艺术家的映射
  const existingArtistMap = new Map<string, any>()
  for (const artist of existingArtists) {
    if (artist.userId) {
      existingArtistMap.set(artist.userId, artist)
      // 增量更新缓存
      context.artistCache.set(artist.userId, artist)
    }
  }

  // 3. 筛选出需要新建的艺术家
  const artistsToCreate = []
  for (const artwork of artworks) {
    const userId = artwork.metadata.userId
    if (userId && uncachedUserIds.has(userId) && !existingArtistMap.has(userId)) {
      artistsToCreate.push({
        name: artwork.metadata.user,
        username: artwork.metadata.user,
        userId: userId,
        bio: `Artist from external source (ID: ${userId})`
      })
    }
  }

  // 4. 批量创建新艺术家
  if (artistsToCreate.length > 0) {
    logger.info('Creating new artists in batch:', { artistsToCreateCount: artistsToCreate.length })

    await prisma.artist.createMany({
      data: artistsToCreate,
      skipDuplicates: true
    })

    context.scanResult.newArtists += artistsToCreate.length

    // 再次查询新创建的艺术家获取完整信息
    const newlyCreatedArtists = await prisma.artist.findMany({
      where: {
        userId: {
          in: artistsToCreate.map((a) => a.userId)
        }
      }
    })

    // 增量更新缓存
    for (const artist of newlyCreatedArtists) {
      if (artist.userId) {
        context.artistCache.set(artist.userId, artist)
      }
    }
  }

  logger.info('Batch artist processing completed:', { totalArtistsInCache: context.artistCache.size })
}

/**
 * 批量预处理当前批次作品的标签（增量处理）
 * @param artworks 作品数组
 * @param context 扫描上下文
 */
async function batchProcessTags(artworks: ArtworkData[], context: ScanContext): Promise<void> {
  // 1. 收集当前批次中缓存中不存在的标签名称
  const uncachedTagNames = new Set<string>()
  for (const artwork of artworks) {
    if (artwork.metadata.tags && artwork.metadata.tags.length > 0) {
      for (const tagName of artwork.metadata.tags) {
        if (tagName && !context.tagCache.has(tagName)) {
          uncachedTagNames.add(tagName)
        }
      }
    }
  }

  if (uncachedTagNames.size === 0) {
    logger.info('All tags in current batch are already cached, skipping tag processing')
    return
  }

  logger.info('Processing uncached tags in current batch:', { uncachedTags: uncachedTagNames.size })

  // 2. 批量查询数据库中已存在的标签
  const existingTags = await prisma.tag.findMany({
    where: {
      name: {
        in: Array.from(uncachedTagNames)
      }
    },
    select: {
      id: true,
      name: true
    }
  })

  // 构建已存在标签的映射并增量更新缓存
  const existingTagMap = new Map<string, number>()
  for (const tag of existingTags) {
    existingTagMap.set(tag.name, tag.id)
    // 增量更新缓存
    context.tagCache.set(tag.name, tag.id)
  }

  // 3. 筛选出需要新建的标签
  const tagsToCreate = Array.from(uncachedTagNames).filter((tagName) => !existingTagMap.has(tagName))

  // 4. 批量创建操作：一次性创建所有新标签
  if (tagsToCreate.length > 0) {
    logger.info('Creating new tags in batch:', { tagsToCreateCount: tagsToCreate.length })

    await prisma.tag.createMany({
      data: tagsToCreate.map((name) => ({ name })),
      skipDuplicates: true // 防止并发创建重复标签
    })

    context.scanResult.newTags += tagsToCreate.length

    // 再次查询新创建的标签获取其ID
    const newlyCreatedTags = await prisma.tag.findMany({
      where: {
        name: {
          in: tagsToCreate
        }
      },
      select: {
        id: true,
        name: true
      }
    })

    // 增量更新缓存
    for (const tag of newlyCreatedTags) {
      context.tagCache.set(tag.name, tag.id)
    }
  }

  logger.info('Batch tag processing completed:', { totalTagsInCache: context.tagCache.size })
}

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
    // 仅在指定目录下查找 ID-meta.txt
    const files = await fg([`${artworkId}-meta.txt`], {
      cwd: targetDir,
      absolute: true,
      deep: 1, // 仅在当前目录查找，不递归
      onlyFiles: true
    })

    if (files.length <= 0) {
      throw new Error(`在目录 "${cleanPath}" 中未找到作品 ${artworkId} 的元数据文件`)
    }

    const _file = files[0]!
    const metadataFile: GlobMetadataFile = {
      name: path.basename(_file),
      artworkId: artworkId,
      path: _file,
      createdAt: new Date()
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
 * 批量处理重新扫描的作品（更新逻辑）
 * @param batch 作品数据数组
 * @param context 扫描上下文
 */
async function processRescanBatch(batch: ArtworkData[], context: ScanContext): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const artworkData of batch) {
        const { metadata, directoryCreatedAt, metadataFilePath } = artworkData

        // 获取 Artist ID
        const artist = context.artistCache.get(metadata.userId)
        if (!artist) {
          throw new Error(`Artist not found for user ID: ${metadata.userId}`)
        }

        // 1. 更新 Artwork 基础信息
        // 查找现有 Artwork
        const existingArtwork = await tx.artwork.findUnique({
          where: { externalId: metadata.id }
        })

        if (!existingArtwork) {
          throw new Error(`Artwork with externalId ${metadata.id} not found in database`)
        }

        logger.debug('update artwork:', existingArtwork, {
          title: metadata.title,
          description: metadata.description || null,
          artistId: artist.id,
          descriptionLength: metadata.description?.length || 0,
          sourceUrl: metadata.url || null,
          originalUrl: metadata.original || null,
          thumbnailUrl: metadata.thumbnail || null,
          xRestrict: metadata.xRestrict || null,
          isAiGenerated: metadata.ai === 'Yes',
          size: metadata.size || null,
          bookmarkCount: metadata.bookmark || null,
          sourceDate: metadata.date || null,
          directoryCreatedAt
        })

        await tx.artwork.update({
          where: { id: existingArtwork.id },
          data: {
            title: metadata.title,
            description: metadata.description || null,
            artistId: artist.id,
            descriptionLength: metadata.description?.length || 0,
            sourceUrl: metadata.url || null,
            originalUrl: metadata.original || null,
            thumbnailUrl: metadata.thumbnail || null,
            xRestrict: metadata.xRestrict || null,
            isAiGenerated: metadata.ai === 'Yes',
            size: metadata.size || null,
            bookmarkCount: metadata.bookmark || null,
            sourceDate: metadata.date || null,
            directoryCreatedAt,
            metaSource: getMetaSource(metadataFilePath, context.options.scanPath)
          }
        })

        // 2. 更新图片 (删除旧的，插入新的)
        // 删除旧图片
        await tx.image.deleteMany({
          where: { artworkId: existingArtwork.id }
        })

        // 插入新图片
        if (artworkData.mediaFiles.length > 0) {
          const imagesToCreate = artworkData.mediaFiles.map((mediaFile) => ({
            path: getRelativePath(mediaFile.path, context.options.scanPath),
            size: mediaFile.size,
            sortOrder: mediaFile.sortOrder,
            artworkId: existingArtwork.id
          }))

          logger.debug('imagesToCreate:', imagesToCreate)
          await tx.image.createMany({
            data: imagesToCreate
          })
          context.scanResult.newImages += imagesToCreate.length
        }

        context.scanResult.newArtworks += 1 // 借用这个字段表示处理成功数
      }
    },
    {
      timeout: 30000,
      maxWait: 5000
    }
  )
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

/**
 * 获取相对路径
 * @param fullPath 完整路径
 * @param scanPath 扫描路径
 * @returns 相对路径
 */
function getRelativePath(fullPath: string, scanPath: string): string {
  // 1. 【清洗】强制把所有反斜杠 (\) 替换为正斜杠 (/)
  // 这样无论输入是 Windows 风格还是混合风格，都统一变成 POSIX 风格
  const normFull = fullPath.replace(/\\/g, '/')
  const normScan = scanPath.replace(/\\/g, '/')

  // 2. 【计算】强制使用 path.posix.relative
  // 因为此时 inputs 已经确认为 / 分隔，使用 posix 算法是最安全、准确的
  // const relative = path.posix.relative(normScan, normFull)
  return normFull.replace(normScan, '') // WARNNING: 历史原因 需要保留 / 开头...
}

/**
 * 获取元数据文件的相对路径
 * @param fullPath 完整路径
 * @param scanPath 扫描路径
 * @returns 相对路径
 */
function getMetaSource(fullPath: string, scanPath: string): string {
  return getRelativePath(fullPath, scanPath).replace(/^\//, '') // 移除开头的 /
}

/**
 * 调用远程扫描服务获取元数据文件列表
 * @param directoryPath 目录路径
 * @returns 远程服务返回的文件路径数组
 */
async function callRemoteScannerService(directoryPath: string): Promise<string[]> {
  const useRemoteScanner = process.env.USE_REMOTE_SCANNER === 'true'
  const remoteScannerUrl = process.env.REMOTE_SCANNER_URL || 'http://localhost:3000'

  if (!useRemoteScanner) {
    throw new Error('Remote scanner is not enabled')
  }

  const maxRetries = 3
  let lastError: Error | null = null

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`Calling remote scanner service (attempt ${attempt}/${maxRetries})`, {
        url: remoteScannerUrl,
        directoryPath
      })

      const response = await fetch(`${remoteScannerUrl}/metadata-files`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        // 设置超时时间为 30 秒
        signal: AbortSignal.timeout(30000)
      })

      if (!response.ok) {
        throw new Error(`Remote scanner service returned ${response.status}: ${response.statusText}`)
      }

      const data = await response.json()

      if (!Array.isArray(data)) {
        throw new Error('Remote scanner service returned invalid data format')
      }

      logger.info('Successfully received metadata files from remote scanner', {
        fileCount: data.length,
        attempt
      })

      return data
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('Unknown error')
      logger.warn(`Remote scanner service call failed (attempt ${attempt}/${maxRetries})`, {
        error: lastError.message,
        url: remoteScannerUrl
      })

      // 如果不是最后一次尝试，等待一段时间后重试
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) // 指数退避，最大 5 秒
        logger.info(`Retrying in ${delay}ms...`)
        await sleep(delay)
      }
    }
  }

  throw new Error(`Remote scanner service failed after ${maxRetries} attempts: ${lastError?.message}`)
}
