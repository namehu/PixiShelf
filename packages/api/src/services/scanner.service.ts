import path from 'path'
import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import { ScanProgress, ScanResult } from '@pixishelf/shared'
import { MetadataParser, MetadataInfo } from './scanner/MetadataParser'
import { MediaCollector, MediaFileInfo } from './scanner/MediaCollector'
import fg from 'fast-glob'

/**
 * 扫描选项接口
 */
export interface ScanOptions {
  scanPath: string
  forceUpdate?: boolean
  onProgress?: (progress: ScanProgress) => void
}

/**
 * 作品数据接口
 */
interface ArtworkData {
  metadata: MetadataInfo
  mediaFiles: MediaFileInfo[]
  directoryPath: string
  directoryCreatedAt: Date
}

interface GlobMetadataFile {
  name: string
  artworkId: string
  path: string
  createdAt: Date
}

/**
 * 扫描器服务
 * 基于元数据文件的简单直接的扫描实现
 */
export class ScannerService {
  private prisma: PrismaClient
  private logger: FastifyInstance['log']
  private metadataParser: MetadataParser
  private mediaCollector: MediaCollector
  private tagCache: Map<string, number> = new Map() // 标签名称到ID的映射缓存
  private artistCache: Map<string, any> = new Map() // 艺术家缓存，key为userId
  private scanResult: ScanResult = {
    totalArtworks: 0,
    newArtists: 0,
    newArtworks: 0,
    newImages: 0,
    newTags: 0,
    skippedArtworks: 0,
    errors: [],
    processingTime: 0,
    removedArtworks: 0
  }

  constructor(prisma: PrismaClient, logger: FastifyInstance['log']) {
    this.prisma = prisma
    this.logger = logger
    this.metadataParser = new MetadataParser(logger)
    this.mediaCollector = new MediaCollector(logger)
  }

  /**
   * 扫描方法
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async scan(options: ScanOptions): Promise<ScanResult> {
    this.logger.info({ scanPath: options.scanPath }, 'Starting scan with scanner')

    const startTime = Date.now()

    // 清空缓存，确保每次扫描都有干净的状态
    this.tagCache.clear()
    this.artistCache.clear()

    try {
      this.logger.info({ scanPath: options.scanPath }, 'Starting scan')

      // 如果是强制更新，先清空数据库（10%权重）
      if (options.forceUpdate) {
        options.onProgress?.({
          phase: 'counting',
          message: '正在清空数据库...',
          percentage: 0
        })

        await this.clearDatabase()

        this.logger.info('Database cleared for force update')

        options.onProgress?.({
          phase: 'counting',
          message: '数据库清空完成，开始发现作品...',
          percentage: 10
        })
      }

      // 阶段1: 发现作品（40%权重：10%-50%）
      options.onProgress?.({
        phase: 'counting',
        message: '正在发现作品...',
        percentage: options.forceUpdate ? 10 : 0
      })

      let artworks: ArtworkData[] = []

      try {
        artworks = await this.discoverArtworks(options.scanPath, options.forceUpdate, options.onProgress)
      } catch (error) {
        this.logger.error({ error, scanPath: options.scanPath }, 'Failed to discover artworks')
      }

      this.logger.info({ totalArtworks: this.scanResult.totalArtworks }, 'Discovered artworks')

      if (artworks.length === 0) {
        options.onProgress?.({
          phase: 'complete',
          message: '未发现任何作品',
          percentage: 100
        })
        this.scanResult.processingTime = Date.now() - startTime
        return this.scanResult
      }

      // 阶段2: 处理作品（40%权重：50%-90%）
      options.onProgress?.({
        phase: 'scanning',
        message: '正在处理作品...',
        current: 0,
        total: artworks.length,
        percentage: 50
      })

      await this.processArtworks(artworks, options)

      // 完成（10%权重：90%-100%）
      options.onProgress?.({
        phase: 'complete',
        message: '正在完成扫描...',
        percentage: 90
      })

      // 最终完成
      options.onProgress?.({
        phase: 'complete',
        message: '扫描完成',
        percentage: 100
      })

      this.scanResult.processingTime = Date.now() - startTime

      this.logger.info(
        {
          result: this.scanResult,
          processingTimeMs: this.scanResult.processingTime
        },
        'Scan completed'
      )

      return this.scanResult
    } catch (error) {
      this.logger.error({ error, options }, 'Scan failed')
      this.scanResult.errors.push(error instanceof Error ? error.message : 'Unknown error')
      this.scanResult.processingTime = Date.now() - startTime
      return this.scanResult
    }
  }

  /**
   * 递归发现作品
   * @param directoryPath 目录路径
   * @param forceUpdate 是否强制更新
   * @param onProgress 进度回调
   */
  private async discoverArtworks(
    directoryPath: string,
    forceUpdate: boolean = false,
    onProgress?: (progress: ScanProgress) => void
  ): Promise<ArtworkData[]> {
    const artworks: ArtworkData[] = []
    try {
      const metadataFiles = await this.globMetadataFiles(directoryPath, forceUpdate)
      if (!metadataFiles) {
        this.logger.warn({ directoryPath }, 'metadataFiles is empty, skipping')
        return artworks
      }

      // 处理当前目录的元数据文件
      for (let i = 0; i < metadataFiles.length; i++) {
        const metadataFile = metadataFiles[i]

        const { artworkId } = metadataFile
        const metadataPath = metadataFile.path
        const metadataFilename = metadataFile.name

        if (!artworkId) {
          this.logger.warn({ metadataFilename }, 'Invalid metadata filename')
          continue
        }

        try {
          // 解析元数据
          const parseResult = await this.metadataParser.parseMetadataFile(metadataPath)
          if (!parseResult.success || !parseResult.metadata) {
            this.logger.warn({ metadataPath, error: parseResult.error }, 'Failed to parse metadata')
            continue
          }

          // 收集媒体文件
          const collectionResult = await this.mediaCollector.collectMediaFiles(path.dirname(metadataPath), artworkId)
          if (!collectionResult.success) {
            this.logger.warn(
              { directoryPath, artworkId, error: collectionResult.error },
              'Failed to collect media files'
            )
            continue
          }

          if (collectionResult.mediaFiles.length === 0) {
            this.logger.warn({ directoryPath, artworkId }, 'No media files found for artwork')
            continue
          }

          artworks.push({
            metadata: parseResult.metadata,
            mediaFiles: collectionResult.mediaFiles,
            directoryPath,
            directoryCreatedAt: metadataFile.createdAt
          })

          // 更新发现作品的进度（40%权重内的进度）
          const progressInDiscovery = (i / metadataFiles.length) * 40
          const basePercentage = forceUpdate ? 10 : 0
          onProgress?.({
            phase: 'counting',
            message: `发现作品: ${parseResult.metadata?.title || metadataFilename}`,
            current: i + 1,
            total: metadataFiles.length,
            percentage: Math.round(basePercentage + progressInDiscovery)
          })
        } catch (error) {
          this.logger.error({ error, metadataPath }, 'Error processing metadata file')
        }
      }
    } catch (error) {
      this.logger.error({ error, directoryPath }, 'Failed to read directory')
      // 不要重新抛出错误，继续处理其他目录
    }
    return artworks
  }

  /**
   * 递归查找元数据文件
   * @param directoryPath 目录路径
   * @param forceUpdate 是否强制更新
   * @returns 元数据文件数组
   */
  private async globMetadataFiles(directoryPath: string, forceUpdate: boolean = false): Promise<GlobMetadataFile[]> {
    // 查找 数字-meta.txt 格式的文件
    const files = await fg(['**/*-meta.txt'], {
      cwd: path.resolve(directoryPath),
      deep: 4,
      stats: true,
      absolute: true,
      onlyFiles: true
    })

    // 过滤出符合 数字-meta.txt 格式的文件
    const validFiles = files
      .map((file) => {
        const name = path.basename(file.path)
        return {
          name,
          createdAt: file.stats?.birthtime!,
          artworkId: MetadataParser.extractArtworkIdFromFilename(name)!,
          path: file.path
        }
      })
      .filter((file) => !!file.artworkId)

    this.scanResult.totalArtworks = validFiles.length // 发现总作品数

    // 如果不是强制更新，需要过滤掉已存在的作品
    let filesToProcess = validFiles
    if (!forceUpdate) {
      const artworkIds = validFiles.map(({ artworkId }) => artworkId) // 提取所有文件的 artworkId

      if (artworkIds.length > 0) {
        // 查询数据库中已存在的 externalId
        const existingArtworks = await this.prisma.artwork.findMany({
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

        this.scanResult.skippedArtworks = validFiles.length - filesToProcess.length // 已存在作品数

        this.logger.debug(
          {
            totalFiles: validFiles.length,
            existingFiles: validFiles.length - filesToProcess.length,
            filesToProcess: filesToProcess.length
          },
          'Filtered metadata files based on existing artworks'
        )
      }
    }
    // filesToProcess 中如果artworkId 有重复的 则保留一个并发生成错误日志信息
    const artworkIdSet: Record<string, GlobMetadataFile> = {}
    filesToProcess = filesToProcess.filter((file: any) => {
      if (artworkIdSet[file.artworkId]) {
        this.scanResult.errors.push(
          `Duplicate artworkId found: ${file.artworkId}\n ${artworkIdSet[file.artworkId].path} \n ${file.path}`
        )
        this.logger.warn({ artworkId: file.artworkId }, 'Duplicate artworkId found')
        return false
      }
      artworkIdSet[file.artworkId] = file
      return true
    })

    // 获取文件统计信息

    return filesToProcess
  }

  /**
   * 处理作品（批量处理优化版本）
   * @param artworks 作品数组
   * @param options 扫描选项
   */
  private async processArtworks(artworks: ArtworkData[], options: ScanOptions): Promise<void> {
    // 批量预处理标签
    await this.batchProcessTags(artworks)

    // 批量预处理艺术家
    await this.batchProcessArtists(artworks)

    const BATCH_SIZE = 100
    const totalBatches = Math.ceil(artworks.length / BATCH_SIZE)

    for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
      const startIndex = batchIndex * BATCH_SIZE
      const endIndex = Math.min(startIndex + BATCH_SIZE, artworks.length)
      const batch = artworks.slice(startIndex, endIndex)

      try {
        // 更新进度（40%权重内的进度：50%-90%）
        const progressInProcessing = (endIndex / artworks.length) * 40
        options.onProgress?.({
          phase: 'scanning',
          message: `正在处理批次 ${batchIndex + 1}/${totalBatches} (${batch.length} 个作品)`,
          current: endIndex,
          total: artworks.length,
          percentage: Math.round(50 + progressInProcessing)
        })

        await this.processBatch(batch)
      } catch (error) {
        this.logger.error({ error, batchIndex, batchSize: batch.length }, 'Failed to process batch')
        this.scanResult.errors.push(
          `Failed to process batch ${batchIndex + 1}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }
  }

  /**
   * 批量处理一个批次的作品（使用事务）
   * @param batch 批次作品数组
   */
  private async processBatch(batch: ArtworkData[]): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // 准备批量数据
      const artworksToCreate = []
      const imagesToCreate = []
      const artworkTagsToCreate = []

      for (const artworkData of batch) {
        const { metadata, mediaFiles, directoryCreatedAt } = artworkData

        // 从缓存获取艺术家
        const artist = this.artistCache.get(metadata.userId)
        if (!artist) {
          this.logger.warn(
            { userId: metadata.userId },
            'Artist not found in cache, this should not happen after batch processing'
          )
          continue
        }

        const imageCount = mediaFiles.length

        // 准备作品数据
        const artworkToCreate = {
          title: metadata.title,
          description: metadata.description,
          artistId: artist.id,
          imageCount,
          descriptionLength: metadata.description?.length || 0,
          externalId: metadata.id,
          sourceUrl: metadata.url,
          originalUrl: metadata.original,
          thumbnailUrl: metadata.thumbnail,
          xRestrict: metadata.xRestrict,
          isAiGenerated: metadata.ai === 'Yes',
          size: metadata.size,
          bookmarkCount: metadata.bookmark,
          sourceDate: metadata.date,
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

        this.scanResult.newArtworks += artworksToCreate.length

        // 查询刚创建的作品以获取 ID（通过 externalId 匹配）
        const externalIds = artworksToCreate.map(a => a.externalId)
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
              path: this.getRelativePath(mediaFile.path),
              size: mediaFile.size,
              sortOrder: mediaFile.sortOrder,
              artworkId: artwork.id
            }))
            imagesToCreate.push(...artworkImages)
          }

          // 准备标签关联数据
          if (artworkData.metadata.tags && artworkData.metadata.tags.length > 0) {
            for (const tagName of artworkData.metadata.tags) {
              const trimmedTagName = tagName.trim()
              if (!trimmedTagName) continue

              const tagId = this.tagCache.get(trimmedTagName)
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
          this.scanResult.newImages += imagesToCreate.length
        }

        // 批量创建作品-标签关联
        if (artworkTagsToCreate.length > 0) {
          await tx.artworkTag.createMany({
            data: artworkTagsToCreate,
            skipDuplicates: true
          })
        }
      }
    }, {
      timeout: 30000, // 增加事务超时时间到 30 秒
      maxWait: 5000,  // 最大等待时间 5 秒
    })
  }

  /**
   * 批量预处理所有作品的艺术家
   * @param artworks 作品数组
   */
  private async batchProcessArtists(artworks: ArtworkData[]): Promise<void> {
    // 1. 收集所有唯一的艺术家用户ID
    const uniqueUserIds = new Set<string>()
    for (const artwork of artworks) {
      if (artwork.metadata.userId) {
        uniqueUserIds.add(artwork.metadata.userId)
      }
    }

    if (uniqueUserIds.size === 0) {
      this.logger.debug('No artists found in artworks, skipping batch artist processing')
      return
    }

    this.logger.debug({ totalUniqueArtists: uniqueUserIds.size }, 'Starting batch artist processing')

    // 2. 批量查询数据库中已存在的艺术家
    const existingArtists = await this.prisma.artist.findMany({
      where: {
        userId: {
          in: Array.from(uniqueUserIds)
        }
      }
    })

    // 构建已存在艺术家的映射
    const existingArtistMap = new Map<string, any>()
    for (const artist of existingArtists) {
      if (artist.userId) {
        existingArtistMap.set(artist.userId, artist)
      }
    }

    // 3. 筛选出需要新建的艺术家
    const artistsToCreate = []
    for (const artwork of artworks) {
      const userId = artwork.metadata.userId
      if (userId && !existingArtistMap.has(userId) && !this.artistCache.has(userId)) {
        artistsToCreate.push({
          name: artwork.metadata.user,
          username: artwork.metadata.user,
          userId: userId,
          bio: `Artist from external source (ID: ${userId})`
        })
        // 临时标记，避免重复创建
        this.artistCache.set(userId, null)
      }
    }

    // 4. 批量创建新艺术家
    if (artistsToCreate.length > 0) {
      this.logger.debug({ artistsToCreateCount: artistsToCreate.length }, 'Creating new artists in batch')

      await this.prisma.artist.createMany({
        data: artistsToCreate,
        skipDuplicates: true
      })

      this.scanResult.newArtists += artistsToCreate.length

      // 再次查询新创建的艺术家获取完整信息
      const newlyCreatedArtists = await this.prisma.artist.findMany({
        where: {
          userId: {
            in: artistsToCreate.map((a) => a.userId)
          }
        }
      })

      // 更新映射
      for (const artist of newlyCreatedArtists) {
        if (artist.userId) {
          existingArtistMap.set(artist.userId, artist)
        }
      }
    }

    // 5. 存入缓存
    this.artistCache = existingArtistMap

    this.logger.debug({ totalArtistsInCache: this.artistCache.size }, 'Batch artist processing completed')
  }

  /**
   * 批量预处理所有作品的标签
   * @param artworks 作品数组
   */
  private async batchProcessTags(artworks: ArtworkData[]): Promise<void> {
    // 1. 预处理阶段：收集所有标签名称到 Set 集合中实现自动去重
    const allTagNames = new Set<string>()
    for (const artwork of artworks) {
      if (artwork.metadata.tags && artwork.metadata.tags.length > 0) {
        for (const tagName of artwork.metadata.tags) {
          allTagNames.add(tagName)
        }
      }
    }

    if (allTagNames.size === 0) {
      this.logger.debug('No tags found in artworks, skipping batch tag processing')
      return
    }

    this.logger.debug({ totalUniqueTagNames: allTagNames.size }, 'Starting batch tag processing')

    // 2. 数据库查询优化：批量查询数据库中已存在的标签
    const existingTags = await this.prisma.tag.findMany({
      where: {
        name: {
          in: Array.from(allTagNames)
        }
      },
      select: {
        id: true,
        name: true
      }
    })

    // 构建已存在标签的映射
    const existingTagMap = new Map<string, number>()
    for (const tag of existingTags) {
      existingTagMap.set(tag.name, tag.id)
    }

    // 3. 筛选出需要新建的标签
    const tagsToCreate = Array.from(allTagNames).filter((tagName) => !existingTagMap.has(tagName))

    // 4. 批量创建操作：一次性创建所有新标签
    if (tagsToCreate.length > 0) {
      this.logger.debug({ tagsToCreateCount: tagsToCreate.length }, 'Creating new tags in batch')

      await this.prisma.tag.createMany({
        data: tagsToCreate.map((name) => ({ name })),
        skipDuplicates: true // 防止并发创建重复标签
      })

      this.scanResult.newTags += tagsToCreate.length

      // 再次查询新创建的标签获取其ID
      const newlyCreatedTags = await this.prisma.tag.findMany({
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

      // 更新映射
      for (const tag of newlyCreatedTags) {
        existingTagMap.set(tag.name, tag.id)
      }
    }

    // 5. 存入缓存以便快速查找
    this.tagCache = existingTagMap

    this.logger.debug({ totalTagsInCache: this.tagCache.size }, 'Batch tag processing completed')
  }

  /**
   * 清空数据库（保留 user 和 setting 表）
   * 用于强制全量扫描时清空所有艺术相关数据
   */
  private async clearDatabase(): Promise<void> {
    try {
      this.logger.info('Starting database cleanup for force update')

      // 按照外键依赖顺序删除数据
      // 1. 删除作品标签关联
      await this.prisma.artworkTag.deleteMany({})
      this.logger.debug('Deleted all artwork-tag associations')

      // 2. 删除图片
      await this.prisma.image.deleteMany({})
      this.logger.debug('Deleted all images')

      // 3. 删除作品
      await this.prisma.artwork.deleteMany({})
      this.logger.debug('Deleted all artworks')

      // 4. 删除艺术家
      await this.prisma.artist.deleteMany({})
      this.logger.debug('Deleted all artists')

      // 5. 删除标签
      await this.prisma.tag.deleteMany({})
      this.logger.debug('Deleted all tags')

      this.logger.info('Database cleanup completed successfully')
    } catch (error) {
      this.logger.error({ error }, 'Failed to clear database')
      throw new Error(`Database cleanup failed: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * 获取相对路径
   * @param fullPath 完整路径
   * @returns 相对路径
   */
  private getRelativePath(fullPath: string): string {
    // 简单实现，可以根据需要调整
    return fullPath
  }
}
