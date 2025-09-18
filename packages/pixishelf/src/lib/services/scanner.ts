import path from 'path'
import { PrismaClient } from '@prisma/client'
import { ScanProgress, ScanResult } from '@pixishelf/shared'
import { MetadataParser, MetadataInfo } from './scanner/metadata-parser'
import { MediaCollector, MediaFileInfo } from './scanner/media-collector'
import { getPrisma } from '@/lib/prisma'
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
 * 适配Next.js环境
 */
export class ScannerService {
  private prisma: PrismaClient
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

  constructor() {
    this.prisma = getPrisma()
    this.metadataParser = new MetadataParser()
    this.mediaCollector = new MediaCollector()
  }

  /**
   * 扫描方法
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async scan(options: ScanOptions): Promise<ScanResult> {
    console.log('Starting scan with scanner:', { scanPath: options.scanPath })

    const startTime = Date.now()

    // 清空缓存，确保每次扫描都有干净的状态
    this.tagCache.clear()
    this.artistCache.clear()

    try {
      console.log('Starting scan:', { scanPath: options.scanPath })

      // 如果是强制更新，先清空数据库（10%权重）
      if (options.forceUpdate) {
        options.onProgress?.({
          phase: 'counting',
          message: '正在清空数据库...',
          percentage: 0
        })

        await this.clearDatabase()

        console.log('Database cleared for force update')

        options.onProgress?.({
          phase: 'counting',
          message: '数据库清空完成，开始发现作品...',
          percentage: 10
        })
      }

      // 直接调用流式处理方法，取代原来的发现+处理模式
      await this.streamProcessArtworks(options)

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

      console.log('Scan completed:', {
        result: this.scanResult,
        processingTimeMs: this.scanResult.processingTime
      })

      return this.scanResult
    } catch (error) {
      console.error('Scan failed:', { error, options })
      this.scanResult.errors.push(error instanceof Error ? error.message : 'Unknown error')
      this.scanResult.processingTime = Date.now() - startTime
      return this.scanResult
    }
  }

  /**
   * 流式处理作品，取代原来的发现+处理模式
   * 边发现边处理，降低内存峰值
   * @param options 扫描选项
   */
  private async streamProcessArtworks(options: ScanOptions): Promise<void> {
    const BATCH_SIZE = 100 // 定义处理批次的大小
    let artworkBatch: ArtworkData[] = []
    let batchNumber = 0

    // 1. 找到所有需要处理的元数据文件（这一步仍然需要先完成）
    const metadataFiles = await this.globMetadataFiles(options.scanPath, options.forceUpdate)
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

    console.log('Found metadata files, starting stream processing:', { totalFiles, totalBatches })

    // 2. 遍历文件列表，边发现边处理
    for (let i = 0; i < totalFiles; i++) {
      const metadataFile = metadataFiles[i]
      if (!metadataFile) continue

      // 解析单个文件并收集数据
      const artworkData = await this.parseAndCollect(metadataFile)

      if (artworkData) {
        artworkBatch.push(artworkData)
      }

      // 3. 当批次满员，或者已经是最后一个文件时，触发处理
      if (artworkBatch.length >= BATCH_SIZE || (i === totalFiles - 1 && artworkBatch.length > 0)) {
        batchNumber++
        console.log(`Processing batch ${batchNumber} of ${totalBatches} (size: ${artworkBatch.length})...`)

        try {
          // 调用批量处理逻辑（针对当前批次的数据）
          await this.batchProcessTags(artworkBatch)
          await this.batchProcessArtists(artworkBatch)
          await this.processBatch(artworkBatch)

          console.log(`Successfully processed batch ${batchNumber} of ${totalBatches}`)
        } catch (error) {
          console.error('Failed to process batch:', { error, batchNumber, batchSize: artworkBatch.length })
          this.scanResult.errors.push(
            `Failed to process batch ${batchNumber}: ${error instanceof Error ? error.message : 'Unknown error'}`
          )
        }

        // 清空批次，为下一批做准备
        artworkBatch = []

        // 更新总进度（80%权重：10%-90%）
        const progressPercentage = ((i + 1) / totalFiles) * 80
        const basePercentage = options.forceUpdate ? 10 : 0
        options.onProgress?.({
          phase: 'scanning',
          message: `已处理 ${i + 1}/${totalFiles} 个作品`,
          current: i + 1,
          total: totalFiles,
          percentage: Math.round(basePercentage + progressPercentage)
        })
      }
    }
  }

  /**
   * 解析单个元数据文件并收集媒体文件
   * @param metadataFile 元数据文件信息
   * @returns 作品数据或null
   */
  private async parseAndCollect(metadataFile: GlobMetadataFile): Promise<ArtworkData | null> {
    const { artworkId, path: metadataPath, name: metadataFilename, createdAt } = metadataFile

    if (!artworkId) {
      console.warn('Invalid metadata filename:', { metadataFilename })
      return null
    }

    try {
      // 解析元数据
      const parseResult = await this.metadataParser.parseMetadataFile(metadataPath)
      if (!parseResult.success || !parseResult.metadata) {
        console.warn('Failed to parse metadata:', { metadataPath, error: parseResult.error })
        return null
      }

      // 收集媒体文件
      const collectionResult = await this.mediaCollector.collectMediaFiles(path.dirname(metadataPath), artworkId)
      if (!collectionResult.success) {
        console.warn('Failed to collect media files:', { metadataPath, artworkId, error: collectionResult.error })
        return null
      }

      if (collectionResult.mediaFiles.length === 0) {
        console.warn('No media files found for artwork:', { metadataPath, artworkId })
        return null
      }

      return {
        metadata: parseResult.metadata,
        mediaFiles: collectionResult.mediaFiles,
        directoryPath: path.dirname(metadataPath),
        directoryCreatedAt: createdAt
      }
    } catch (error) {
      console.error('Error processing metadata file:', { error, metadataPath })
      return null
    }
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
      absolute: true,
      onlyFiles: true
    })

    const createdAt = new Date()
    // 过滤出符合 数字-meta.txt 格式的文件
    const validFiles = files
      .map((file) => {
        const name = path.basename(file)
        return {
          name,
          createdAt,
          artworkId: MetadataParser.extractArtworkIdFromFilename(name)!,
          path: file
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

        console.log('Filtered metadata files based on existing artworks:', {
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
        this.scanResult.errors.push(
          `Duplicate artworkId found: ${file.artworkId}\n ${existingFile.path} \n ${file.path}`
        )
        console.warn('Duplicate artworkId found:', { artworkId: file.artworkId })
        return false
      }
      artworkIdSet[file.artworkId] = file
      return true
    })

    return filesToProcess
  }

  /**
   * 批量处理一个批次的作品（使用事务）
   * @param batch 批次作品数组
   */
  private async processBatch(batch: ArtworkData[]): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // 准备批量数据
        const artworksToCreate = []
        const imagesToCreate = []
        const artworkTagsToCreate = []

        for (const artworkData of batch) {
          const { metadata, mediaFiles, directoryCreatedAt } = artworkData

          // 从缓存获取艺术家
          const artist = this.artistCache.get(metadata.userId)
          if (!artist) {
            console.warn('Artist not found in cache, this should not happen after batch processing:', {
              userId: metadata.userId
            })
            continue
          }

          const imageCount = mediaFiles.length

          // 准备作品数据
          const artworkToCreate = {
            title: metadata.title,
            description: metadata.description || null,
            artistId: artist.id,
            imageCount,
            descriptionLength: metadata.description?.length || 0,
            externalId: metadata.id,
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

          this.scanResult.newArtworks += artworksToCreate.length

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
                if (!tagName) continue

                const tagId = this.tagCache.get(tagName)
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
   */
  private async batchProcessArtists(artworks: ArtworkData[]): Promise<void> {
    // 1. 收集当前批次中缓存中不存在的艺术家用户ID
    const uncachedUserIds = new Set<string>()
    for (const artwork of artworks) {
      if (artwork.metadata.userId && !this.artistCache.has(artwork.metadata.userId)) {
        uncachedUserIds.add(artwork.metadata.userId)
      }
    }

    if (uncachedUserIds.size === 0) {
      console.log('All artists in current batch are already cached, skipping artist processing')
      return
    }

    console.log('Processing uncached artists in current batch:', { uncachedArtists: uncachedUserIds.size })

    // 2. 批量查询数据库中已存在的艺术家
    const existingArtists = await this.prisma.artist.findMany({
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
        this.artistCache.set(artist.userId, artist)
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
      console.log('Creating new artists in batch:', { artistsToCreateCount: artistsToCreate.length })

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

      // 增量更新缓存
      for (const artist of newlyCreatedArtists) {
        if (artist.userId) {
          this.artistCache.set(artist.userId, artist)
        }
      }
    }

    console.log('Batch artist processing completed:', { totalArtistsInCache: this.artistCache.size })
  }

  /**
   * 批量预处理当前批次作品的标签（增量处理）
   * @param artworks 作品数组
   */
  private async batchProcessTags(artworks: ArtworkData[]): Promise<void> {
    // 1. 收集当前批次中缓存中不存在的标签名称
    const uncachedTagNames = new Set<string>()
    for (const artwork of artworks) {
      if (artwork.metadata.tags && artwork.metadata.tags.length > 0) {
        for (const tagName of artwork.metadata.tags) {
          if (tagName && !this.tagCache.has(tagName)) {
            uncachedTagNames.add(tagName)
          }
        }
      }
    }

    if (uncachedTagNames.size === 0) {
      console.log('All tags in current batch are already cached, skipping tag processing')
      return
    }

    console.log('Processing uncached tags in current batch:', { uncachedTags: uncachedTagNames.size })

    // 2. 批量查询数据库中已存在的标签
    const existingTags = await this.prisma.tag.findMany({
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
      this.tagCache.set(tag.name, tag.id)
    }

    // 3. 筛选出需要新建的标签
    const tagsToCreate = Array.from(uncachedTagNames).filter((tagName) => !existingTagMap.has(tagName))

    // 4. 批量创建操作：一次性创建所有新标签
    if (tagsToCreate.length > 0) {
      console.log('Creating new tags in batch:', { tagsToCreateCount: tagsToCreate.length })

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

      // 增量更新缓存
      for (const tag of newlyCreatedTags) {
        this.tagCache.set(tag.name, tag.id)
      }
    }

    console.log('Batch tag processing completed:', { totalTagsInCache: this.tagCache.size })
  }

  /**
   * 清空数据库（保留 user 和 setting 表）
   * 用于强制全量扫描时清空所有艺术相关数据
   * 使用 TRUNCATE 提供更高的性能
   */
  private async clearDatabase(): Promise<void> {
    try {
      console.log('Starting database cleanup with TRUNCATE for force update')

      // 使用 TRUNCATE 一次性清空所有艺术相关表
      // RESTART IDENTITY 会重置自增ID，CASCADE 会处理外键依赖
      await this.prisma.$executeRawUnsafe(
        'TRUNCATE TABLE "ArtworkTag", "Image", "Artwork", "Artist", "Tag" RESTART IDENTITY CASCADE;'
      )

      console.log('Database cleanup with TRUNCATE completed successfully')
    } catch (error) {
      console.error('Failed to clear database with TRUNCATE:', { error })
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

// 导出单例实例
let scannerServiceInstance: ScannerService | null = null

/**
 * 获取 ScannerService 实例
 */
export function getScannerService(): ScannerService {
  if (!scannerServiceInstance) {
    scannerServiceInstance = new ScannerService()
  }
  return scannerServiceInstance
}