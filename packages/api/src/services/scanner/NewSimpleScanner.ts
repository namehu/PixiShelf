import { Dirent, promises as fs } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import { ScanProgress } from '@pixishelf/shared'
import { NewMetadataParser, MetadataInfo } from './NewMetadataParser'
import { NewMediaCollector, MediaFileInfo } from './NewMediaCollector'

/**
 * 扫描选项接口
 */
export interface SimpleScanOptions {
  scanPath: string // 扫描路径
  forceUpdate?: boolean // 是否强制更新
  onProgress?: (progress: ScanProgress) => void // 进度回调
}

/**
 * 扫描结果接口
 */
export interface SimpleScanResult {
  totalArtworks: number // 发现的作品总数
  processedArtworks: number // 成功处理的作品数
  newArtists: number // 新增艺术家数
  newArtworks: number // 新增作品数
  newImages: number // 新增图片数
  newTags: number // 新增标签数
  skippedArtworks: number // 跳过的作品数
  errors: string[] // 错误信息
  processingTime: number // 处理时间（毫秒）
}

/**
 * 作品数据接口
 */
interface ArtworkData {
  metadata: MetadataInfo
  mediaFiles: MediaFileInfo[]
  directoryPath: string
}

/**
 * 新的简化扫描器
 * 基于元数据文件的简单直接的扫描实现
 */
export class NewSimpleScanner {
  private prisma: PrismaClient
  private logger: FastifyInstance['log']
  private metadataParser: NewMetadataParser
  private mediaCollector: NewMediaCollector

  constructor(prisma: PrismaClient, logger: FastifyInstance['log']) {
    this.prisma = prisma
    this.logger = logger
    this.metadataParser = new NewMetadataParser(logger)
    this.mediaCollector = new NewMediaCollector(logger)
  }

  /**
   * 执行扫描
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async scan(options: SimpleScanOptions): Promise<SimpleScanResult> {
    const startTime = Date.now()

    const result: SimpleScanResult = {
      totalArtworks: 0,
      processedArtworks: 0,
      newArtists: 0,
      newArtworks: 0,
      newImages: 0,
      newTags: 0,
      skippedArtworks: 0,
      errors: [],
      processingTime: 0
    }

    try {
      this.logger.info({ scanPath: options.scanPath }, 'Starting simple scan')

      // 阶段1: 发现作品
      options.onProgress?.({
        phase: 'counting',
        message: '正在发现作品...',
        percentage: 0
      })

      const artworks = await this.discoverArtworks(options.scanPath)
      result.totalArtworks = artworks.length

      this.logger.info({ totalArtworks: result.totalArtworks }, 'Discovered artworks')

      if (artworks.length === 0) {
        options.onProgress?.({
          phase: 'complete',
          message: '未发现任何作品',
          percentage: 100
        })
        result.processingTime = Date.now() - startTime
        return result
      }

      // 阶段2: 处理作品
      options.onProgress?.({
        phase: 'scanning',
        message: '正在处理作品...',
        current: 0,
        total: artworks.length,
        percentage: 10
      })

      await this.processArtworks(artworks, result, options)

      // 阶段3: 清理
      options.onProgress?.({
        phase: 'cleanup',
        message: '正在清理数据...',
        percentage: 95
      })

      await this.cleanup()

      // 完成
      options.onProgress?.({
        phase: 'complete',
        message: '扫描完成',
        percentage: 100
      })

      result.processingTime = Date.now() - startTime

      this.logger.info(
        {
          result,
          processingTimeMs: result.processingTime
        },
        'Scan completed'
      )

      return result
    } catch (error) {
      this.logger.error({ error, options }, 'Scan failed')
      result.errors.push(error instanceof Error ? error.message : 'Unknown error')
      result.processingTime = Date.now() - startTime
      return result
    }
  }

  /**
   * 发现作品
   * @param scanPath 扫描路径
   * @returns 作品数据数组
   */
  private async discoverArtworks(scanPath: string): Promise<ArtworkData[]> {
    const artworks: ArtworkData[] = []

    try {
      await this.discoverArtworksRecursive(scanPath, artworks)
    } catch (error) {
      this.logger.error({ error, scanPath }, 'Failed to discover artworks')
    }

    return artworks
  }

  /**
   * 递归发现作品
   * @param directoryPath 目录路径
   * @param artworks 作品数组
   */
  private async discoverArtworksRecursive(directoryPath: string, artworks: ArtworkData[]): Promise<void> {
    try {
      // 使用更安全的目录读取方法，处理特殊字符
      const entries = await this.safeReaddir(directoryPath)
      if (!entries) {
        this.logger.warn({ directoryPath }, 'Failed to read directory, skipping')
        return
      }

      // 检查当前目录是否包含元数据文件
      const metadataFiles = entries
        .filter((entry) => entry.isFile() && NewMetadataParser.isMetadataFile(entry.name))
        .map((entry) => entry.name)

      // 处理当前目录的元数据文件
      for (const metadataFilename of metadataFiles) {
        const metadataPath = path.join(directoryPath, metadataFilename)
        const artworkId = NewMetadataParser.extractArtworkIdFromFilename(metadataFilename)

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

          // 收集媒体文件 - 使用已读取的entries避免重复IO
          const collectionResult = await this.mediaCollector.collectMediaFilesFromEntries(
            directoryPath,
            artworkId,
            entries
          )
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
            directoryPath
          })
        } catch (error) {
          this.logger.error({ error, metadataPath }, 'Error processing metadata file')
        }
      }

      // 递归处理子目录
      const subdirectories = entries.filter((entry) => entry.isDirectory())
      for (const subdir of subdirectories) {
        const subdirPath = path.join(directoryPath, subdir.name)
        await this.discoverArtworksRecursive(subdirPath, artworks)
      }
    } catch (error) {
      this.logger.error({ error, directoryPath }, 'Failed to read directory')
      // 不要重新抛出错误，继续处理其他目录
    }
  }

  /**
   * 安全地读取目录内容，处理特殊字符和编码问题
   * @param directoryPath 目录路径
   * @returns 目录条目数组或null（如果失败）
   */
  private async safeReaddir(directoryPath: string): Promise<Dirent[] | null> {
    try {
      // 首先尝试标准方法
      return await fs.readdir(directoryPath, { withFileTypes: true })
    } catch (error: any) {
      // 如果是ENOENT错误且可能涉及特殊字符，尝试其他方法
      if (error.code === 'ENOENT' || error.code === 'EINVAL') {
        this.logger.warn(
          {
            directoryPath,
            error: error.message,
            code: error.code
          },
          'Directory read failed, attempting alternative methods'
        )

        try {
          // 尝试使用同步方法（有时在Windows上更可靠）
          const { readdirSync } = await import('fs')
          const entries = readdirSync(directoryPath, { withFileTypes: true })
          this.logger.info({ directoryPath }, 'Successfully read directory using sync method')
          return entries
        } catch (bufferError) {
          this.logger.warn(
            {
              directoryPath,
              error: bufferError,
              originalError: error.message
            },
            'Buffer encoding method also failed'
          )

          try {
            // 最后尝试：使用同步方法（有时在Windows上更可靠）
            const { readdirSync } = await import('fs')
            const entries = readdirSync(directoryPath, { withFileTypes: true })
            this.logger.info({ directoryPath }, 'Successfully read directory using sync method')
            return entries
          } catch (syncError) {
            this.logger.error(
              {
                directoryPath,
                syncError,
                bufferError,
                originalError: error.message
              },
              'All directory reading methods failed'
            )
            return null
          }
        }
      } else {
        // 其他类型的错误
        this.logger.error({ directoryPath, error }, 'Directory read failed with non-encoding error')
        return null
      }
    }
  }

  /**
   * 标准化文件名，处理Unicode编码问题
   * @param filename 原始文件名
   * @returns 标准化后的文件名
   */
  private normalizeFilename(filename: string): string {
    try {
      // 处理Unicode标准化问题
      return filename.normalize('NFC')
    } catch (error) {
      this.logger.warn({ filename, error }, 'Failed to normalize filename')
      return filename
    }
  }

  /**
   * 处理作品
   * @param artworks 作品数组
   * @param result 扫描结果
   * @param options 扫描选项
   */
  private async processArtworks(
    artworks: ArtworkData[],
    result: SimpleScanResult,
    options: SimpleScanOptions
  ): Promise<void> {
    for (let i = 0; i < artworks.length; i++) {
      const artwork = artworks[i]

      try {
        // 更新进度
        options.onProgress?.({
          phase: 'scanning',
          message: `正在处理作品: ${artwork.metadata.title}`,
          current: i + 1,
          total: artworks.length,
          percentage: 10 + Math.floor((i / artworks.length) * 80)
        })

        await this.processArtwork(artwork, result, options.forceUpdate || false)
        result.processedArtworks++
      } catch (error) {
        this.logger.error({ error, artwork: artwork.metadata }, 'Failed to process artwork')
        result.errors.push(
          `Failed to process artwork ${artwork.metadata.title}: ${error instanceof Error ? error.message : 'Unknown error'}`
        )
        result.skippedArtworks++
      }
    }
  }

  /**
   * 处理单个作品
   * @param artworkData 作品数据
   * @param result 扫描结果
   * @param forceUpdate 是否强制更新
   */
  private async processArtwork(
    artworkData: ArtworkData,
    result: SimpleScanResult,
    forceUpdate: boolean
  ): Promise<void> {
    const { metadata, mediaFiles } = artworkData

    // 检查作品是否已存在
    if (!forceUpdate) {
      const existingArtwork = await this.prisma.artwork.findFirst({
        where: {
          OR: [
            { externalId: metadata.id },
            {
              AND: [{ title: metadata.title }, { artist: { userId: metadata.userId } }]
            }
          ]
        }
      })

      if (existingArtwork) {
        this.logger.debug({ artworkId: metadata.id, title: metadata.title }, 'Artwork already exists, skipping')
        result.skippedArtworks++
        return
      }
    }

    // 处理艺术家
    const artist = await this.ensureArtist(metadata, result)

    // 处理作品
    const artwork = await this.ensureArtwork(metadata, artist.id, mediaFiles.length, result)

    // 处理图片
    await this.ensureImages(artwork.id, mediaFiles, result)

    // 处理标签
    if (metadata.tags && metadata.tags.length > 0) {
      await this.ensureTags(artwork.id, metadata.tags, result)
    }
  }

  /**
   * 确保艺术家存在
   * @param metadata 元数据
   * @param result 扫描结果
   * @returns 艺术家记录
   */
  private async ensureArtist(metadata: MetadataInfo, result: SimpleScanResult) {
    let artist = await this.prisma.artist.findFirst({
      where: {
        OR: [{ userId: metadata.userId }, { name: metadata.user }]
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
      result.newArtists++
      this.logger.debug({ artistId: artist.id, name: artist.name }, 'Created new artist')
    }

    return artist
  }

  /**
   * 确保作品存在
   * @param metadata 元数据
   * @param artistId 艺术家ID
   * @param imageCount 图片数量
   * @param result 扫描结果
   * @returns 作品记录
   */
  private async ensureArtwork(metadata: MetadataInfo, artistId: number, imageCount: number, result: SimpleScanResult) {
    let artwork = await this.prisma.artwork.findFirst({
      where: {
        OR: [
          { externalId: metadata.id },
          {
            AND: [{ title: metadata.title }, { artistId }]
          }
        ]
      }
    })

    if (!artwork) {
      artwork = await this.prisma.artwork.create({
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
          sourceDate: metadata.date
        }
      })
      result.newArtworks++
      this.logger.debug({ artworkId: artwork.id, title: artwork.title }, 'Created new artwork')
    } else {
      // 更新现有作品
      artwork = await this.prisma.artwork.update({
        where: { id: artwork.id },
        data: {
          title: metadata.title,
          description: metadata.description,
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
          updatedAt: new Date()
        }
      })
      this.logger.debug({ artworkId: artwork.id, title: artwork.title }, 'Updated existing artwork')
    }

    return artwork
  }

  /**
   * 确保图片存在
   * @param artworkId 作品ID
   * @param mediaFiles 媒体文件列表
   * @param result 扫描结果
   */
  private async ensureImages(artworkId: number, mediaFiles: MediaFileInfo[], result: SimpleScanResult): Promise<void> {
    // 删除现有图片（如果需要更新）
    await this.prisma.image.deleteMany({
      where: { artworkId }
    })

    // 创建新图片记录
    for (const mediaFile of mediaFiles) {
      await this.prisma.image.create({
        data: {
          path: this.getRelativePath(mediaFile.path),
          size: mediaFile.size,
          sortOrder: mediaFile.sortOrder,
          artworkId
        }
      })
      result.newImages++
    }
  }

  /**
   * 确保标签存在
   * @param artworkId 作品ID
   * @param tags 标签列表
   * @param result 扫描结果
   */
  private async ensureTags(artworkId: number, tags: string[], result: SimpleScanResult): Promise<void> {
    // 删除现有标签关联
    await this.prisma.artworkTag.deleteMany({
      where: { artworkId }
    })

    for (const tagName of tags) {
      if (!tagName.trim()) continue

      // 查找或创建标签
      let tag = await this.prisma.tag.findUnique({
        where: { name: tagName }
      })

      if (!tag) {
        tag = await this.prisma.tag.create({
          data: { name: tagName }
        })
        result.newTags++
      }

      // 创建作品-标签关联
      await this.prisma.artworkTag.create({
        data: {
          artworkId,
          tagId: tag.id
        }
      })
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
