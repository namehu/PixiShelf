import { promises as fs } from 'fs'
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

    // 清空标签缓存，确保每次扫描都有干净的状态
    this.tagCache.clear()

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
   * 处理作品
   * @param artworks 作品数组
   * @param options 扫描选项
   */
  private async processArtworks(artworks: ArtworkData[], options: ScanOptions): Promise<void> {
    // 批量预处理标签
    await this.batchProcessTags(artworks)

    for (let i = 0; i < artworks.length; i++) {
      const artwork = artworks[i]

      try {
        // 更新进度（40%权重内的进度：50%-90%）
        const progressInProcessing = (i / artworks.length) * 40
        options.onProgress?.({
          phase: 'scanning',
          message: `正在处理作品: ${artwork.metadata.title}`,
          current: i + 1,
          total: artworks.length,
          percentage: Math.round(50 + progressInProcessing)
        })

        await this.processArtwork(artwork, options.forceUpdate || false)
      } catch (error) {
        this.logger.error({ error, artwork: artwork.metadata }, 'Failed to process artwork')
        this.scanResult.errors.push(
          `Failed to process artwork ${artwork.metadata.title}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
      }
    }
  }

  /**
   * 处理单个作品
   * @param artworkData 作品数据
   * @param forceUpdate 是否强制更新
   */
  private async processArtwork(artworkData: ArtworkData, forceUpdate: boolean): Promise<void> {
    const { metadata, mediaFiles } = artworkData

    // 处理艺术家
    const artist = await this.ensureArtist(metadata)

    // 处理作品
    const artwork = await this.ensureArtwork(artworkData, artist.id)

    // 处理图片
    await this.ensureImages(artwork.id, mediaFiles)

    // 处理标签
    if (metadata.tags && metadata.tags.length > 0) {
      await this.ensureTags(artwork.id, metadata.tags)
    }

    this.scanResult.newArtworks++
  }

  /**
   * 确保艺术家存在
   * @param metadata 元数据
   * @returns 艺术家记录
   */
  private async ensureArtist(metadata: MetadataInfo) {
    let artist = await this.prisma.artist.findFirst({
      where: {
        userId: metadata.userId
      }
    })

    if (!artist) {
      artist = await this.prisma.artist.create({
        data: {
          name: metadata.user,
          username: metadata.user,
          userId: metadata.userId,
          bio: `Artist from external source (ID: ${metadata.userId})`
        }
      })
      this.scanResult.newArtists++
      this.logger.debug({ artistId: artist.id, name: artist.name }, 'Created new artist')
    }

    return artist
  }

  /**
   * 确保作品存在
   * @param artworkData 作品数据
   * @param artistId 艺术家ID
   * @returns 作品记录
   */
  private async ensureArtwork(artworkData: ArtworkData, artistId: number) {
    const { directoryCreatedAt, metadata, mediaFiles } = artworkData
    const imageCount = mediaFiles.length

    const artwork = await this.prisma.artwork.create({
      data: {
        title: metadata.title,
        description: metadata.description,
        artistId,
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
    })
    this.logger.debug({ artworkId: artwork.id, title: artwork.title }, 'Created new artwork')

    return artwork
  }

  /**
   * 确保图片存在
   * @param artworkId 作品ID
   * @param mediaFiles 媒体文件列表
   */
  private async ensureImages(artworkId: number, mediaFiles: MediaFileInfo[]): Promise<void> {
    if (mediaFiles.length) {
      // 创建新图片记录
      await this.prisma.image.createMany({
        data: mediaFiles.map((mediaFile) => ({
          path: this.getRelativePath(mediaFile.path),
          size: mediaFile.size,
          sortOrder: mediaFile.sortOrder,
          artworkId
        }))
      })
      this.scanResult.newImages += mediaFiles.length
    }
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
   * 确保标签存在（优化版本，使用预处理的标签缓存）
   * @param artworkId 作品ID
   * @param tags 标签列表
   */
  private async ensureTags(artworkId: number, tags: string[]): Promise<void> {
    if (!tags || tags.length === 0) {
      return
    }

    // 删除现有标签关联
    await this.prisma.artworkTag.deleteMany({
      where: { artworkId }
    })

    // 构建关联数据，使用缓存的标签ID
    const artworkTagData: { artworkId: number; tagId: number }[] = []

    for (const tagName of tags) {
      if (!tagName) continue

      const tagId = this.tagCache.get(tagName)
      if (tagId) {
        artworkTagData.push({
          artworkId,
          tagId
        })
      } else {
        this.logger.warn(
          { tagName: tagName, artworkId },
          'Tag not found in cache, this should not happen after batch processing'
        )
      }
    }

    // 批量创建作品-标签关联
    if (artworkTagData.length > 0) {
      await this.prisma.artworkTag.createMany({
        data: artworkTagData,
        skipDuplicates: true
      })
    }
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
   * 清理数据
   */
  private async cleanup(): Promise<void> {
    try {
      // 删除没有图片的作品
      const emptyArtworks = await this.prisma.artwork.findMany({
        where: {
          images: {
            none: {}
          }
        },
        select: { id: true }
      })

      if (emptyArtworks.length > 0) {
        const artworkIds = emptyArtworks.map((a) => a.id)

        // 删除相关的标签关联
        await this.prisma.artworkTag.deleteMany({
          where: {
            artworkId: {
              in: artworkIds
            }
          }
        })

        // 删除空作品
        await this.prisma.artwork.deleteMany({
          where: {
            id: {
              in: artworkIds
            }
          }
        })

        this.logger.info({ count: emptyArtworks.length }, 'Cleaned up empty artworks')
      }

      // 删除没有作品的艺术家
      const emptyArtists = await this.prisma.artist.findMany({
        where: {
          artworks: {
            none: {}
          }
        },
        select: { id: true }
      })

      if (emptyArtists.length > 0) {
        await this.prisma.artist.deleteMany({
          where: {
            id: {
              in: emptyArtists.map((a) => a.id)
            }
          }
        })

        this.logger.info({ count: emptyArtists.length }, 'Cleaned up empty artists')
      }

      // 删除没有关联的标签
      const unusedTags = await this.prisma.tag.findMany({
        where: {
          artworkTags: {
            none: {}
          }
        },
        select: { id: true }
      })

      if (unusedTags.length > 0) {
        await this.prisma.tag.deleteMany({
          where: {
            id: {
              in: unusedTags.map((t) => t.id)
            }
          }
        })

        this.logger.info({ count: unusedTags.length }, 'Cleaned up unused tags')
      }
    } catch (error) {
      this.logger.error({ error }, 'Failed to cleanup data')
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
