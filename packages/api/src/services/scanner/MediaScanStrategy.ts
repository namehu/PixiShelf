import { promises as fs } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import { ExtendedScanOptions, ExtendedScanResult, IScanStrategy, ValidationResult, MediaFile } from '@pixishelf/shared'
import { FileAssociator } from './FileAssociator'
import { BatchProcessor } from './BatchProcessor'
import { ConcurrencyController } from './ConcurrencyController'
import { ImageData } from './types'

/**
 * 媒体文件扫描策略实现
 * 负责基于现有作品记录扫描和关联媒体文件
 */
export class MediaScanStrategy implements IScanStrategy {
  readonly name = 'media'
  readonly description = 'Scan media files and associate them with existing artworks'

  private fileAssociator: FileAssociator
  private batchProcessor: BatchProcessor
  private concurrencyController: ConcurrencyController

  constructor(
    private prisma: PrismaClient,
    private logger: FastifyInstance['log'],
    private options: {
      maxConcurrency?: number
      batchSize?: number
    } = {}
  ) {
    this.fileAssociator = new FileAssociator()
    this.batchProcessor = new BatchProcessor(prisma, logger)
    this.concurrencyController = new ConcurrencyController(options.maxConcurrency || 4)
  }

  /**
   * 执行媒体文件扫描策略
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async execute(options: ExtendedScanOptions): Promise<ExtendedScanResult> {
    const result: ExtendedScanResult = {
      scannedDirectories: 0,
      foundImages: 0,
      newArtworks: 0,
      newImages: 0,
      errors: [],
      skippedDirectories: [],
      metadataFiles: 0,
      processedMetadata: 0,
      skippedMetadata: []
    }

    try {
      this.logger.info({ scanPath: options.scanPath }, 'Starting media scan')

      // 1. 从数据库获取现有作品信息
      const artworks = await this.getArtworksWithExternalIds()

      if (artworks.length === 0) {
        this.logger.warn('No artworks with external IDs found in database')
        return result
      }

      this.logger.info({ count: artworks.length }, 'Found artworks in database')

      // 2. 查找所有元数据文件以确定扫描目录
      const metadataFiles = await this.findMetadataFiles(options.scanPath)
      const directories = new Set(metadataFiles.map((f) => path.dirname(f)))

      result.scannedDirectories = directories.size

      // 3. 并发处理每个目录的媒体文件
      const processedCount = await this.processMediaFiles(Array.from(directories), artworks, result, options.onProgress)

      // 4. 批量写入数据库
      if (processedCount > 0) {
        this.logger.info('Writing media files to database')

        const batchResult = await this.batchProcessor.flush()
        result.newImages = batchResult.imagesCreated

        // 5. 更新作品的图片数量
        await this.updateArtworkImageCounts()

        this.logger.info(
          {
            images: result.newImages,
            directories: result.scannedDirectories
          },
          'Media scan completed'
        )
      }

      return result
    } catch (error) {
      this.logger.error({ error }, 'Media scan failed')
      result.errors.push(error instanceof Error ? error.message : 'Unknown error')
      return result
    }
  }

  /**
   * 验证扫描选项
   * @param options 扫描选项
   * @returns 验证结果
   */
  validate(options: ExtendedScanOptions): ValidationResult {
    const errors: string[] = []

    if (!options.scanPath) {
      errors.push('Scan path is required')
    }

    if (options.scanPath && !path.isAbsolute(options.scanPath)) {
      errors.push('Scan path must be absolute')
    }

    return {
      isValid: errors.length === 0,
      errors
    }
  }

  /**
   * 估算扫描时长
   * @param options 扫描选项
   * @returns 预估时长（毫秒）
   */
  async getEstimatedDuration(options: ExtendedScanOptions): Promise<number> {
    try {
      const metadataFiles = await this.findMetadataFiles(options.scanPath)
      // 估算每个目录处理时间约200ms
      const directories = new Set(metadataFiles.map((f) => path.dirname(f)))
      return directories.size * 200
    } catch {
      return 0
    }
  }

  /**
   * 从数据库获取有外部ID的作品
   * @returns 作品列表
   */
  private async getArtworksWithExternalIds(): Promise<
    Array<{
      id: number
      externalId: string
      title: string
      artist: { name: string } | null
    }>
  > {
    const artworks = await this.prisma.artwork.findMany({
      where: {
        externalId: {
          not: null
        }
      },
      select: {
        id: true,
        externalId: true,
        title: true,
        artist: {
          select: {
            name: true
          }
        }
      }
    })
    
    // 过滤掉externalId为null的记录（虽然理论上不应该有）
    return artworks.filter(artwork => artwork.externalId !== null) as Array<{
      id: number
      externalId: string
      title: string
      artist: { name: string } | null
    }>
  }

  /**
   * 递归查找所有元数据文件
   * @param scanPath 扫描路径
   * @returns 元数据文件路径数组
   */
  private async findMetadataFiles(scanPath: string): Promise<string[]> {
    const metadataFiles: string[] = []

    const processDirectory = async (dirPath: string): Promise<void> => {
      try {
        const entries = await fs.readdir(dirPath, { withFileTypes: true })

        for (const entry of entries) {
          const fullPath = path.join(dirPath, entry.name)

          if (entry.isDirectory()) {
            await processDirectory(fullPath)
          } else if (entry.isFile() && this.isMetadataFile(entry.name)) {
            metadataFiles.push(fullPath)
          }
        }
      } catch (error) {
        this.logger.warn({ dirPath, error }, 'Failed to read directory')
      }
    }

    await processDirectory(scanPath)
    return metadataFiles
  }

  /**
   * 判断文件是否为元数据文件
   * @param filename 文件名
   * @returns 是否为元数据文件
   */
  private isMetadataFile(filename: string): boolean {
    return /^\d+-meta\.txt$/i.test(filename)
  }

  /**
   * 并发处理媒体文件
   * @param directories 目录路径数组
   * @param artworks 作品列表
   * @param result 扫描结果对象
   * @param onProgress 进度回调
   * @returns 处理成功的目录数量
   */
  private async processMediaFiles(
    directories: string[],
    artworks: Array<{
      id: number
      externalId: string
      title: string
      artist: { name: string } | null
    }>,
    result: ExtendedScanResult,
    onProgress?: (progress: any) => void
  ): Promise<number> {
    let processedCount = 0

    // 创建外部ID到作品的映射
    const artworkMap = new Map(artworks.map((a) => [a.externalId, a]))

    const tasks = directories.map((dirPath) => async () => {
      try {
        const processedFiles = await this.processDirectoryMedia(dirPath, artworkMap)
        result.foundImages += processedFiles
        processedCount++

        // 更新进度
        if (onProgress) {
          onProgress({
            phase: 'scanning',
            message: `Processing media files: ${processedCount}/${directories.length}`,
            current: processedCount,
            total: directories.length,
            percentage: Math.round((processedCount / directories.length) * 100)
          })
        }
      } catch (error) {
        this.logger.error({ dirPath, error }, 'Failed to process directory media')
        result.errors.push(`Failed to process ${dirPath}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        result.skippedDirectories?.push({
          path: dirPath,
          reason: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    })

    await this.concurrencyController.executeAll(tasks)
    return processedCount
  }

  /**
   * 处理单个目录的媒体文件
   * @param dirPath 目录路径
   * @param artworkMap 作品映射
   * @returns 处理的文件数量
   */
  private async processDirectoryMedia(
    dirPath: string,
    artworkMap: Map<
      string,
      {
        id: number
        externalId: string
        title: string
        artist: { name: string } | null
      }
    >
  ): Promise<number> {
    let processedFiles = 0

    // 查找目录中的元数据文件
    const metadataFiles = await this.fileAssociator.findMetadataFiles(dirPath)

    for (const metadataFile of metadataFiles) {
      const artworkId = this.fileAssociator.extractArtworkIdFromMetadata(path.basename(metadataFile))

      if (!artworkId) {
        this.logger.warn({ metadataFile }, 'Could not extract artwork ID from metadata file')
        continue
      }

      const artwork = artworkMap.get(artworkId)
      if (!artwork) {
        this.logger.debug({ artworkId }, 'Artwork not found in database, skipping media files')
        continue
      }

      // 查找关联的媒体文件
      const mediaFiles = await this.fileAssociator.findMediaFiles(metadataFile, artworkId)

      if (mediaFiles.length === 0) {
        this.logger.debug({ artworkId, metadataFile }, 'No media files found for artwork')
        continue
      }

      // 验证文件关联
      if (!this.fileAssociator.validateAssociation(metadataFile, mediaFiles)) {
        this.logger.warn({ artworkId, metadataFile }, 'Invalid media file association')
        continue
      }

      // 添加媒体文件到批量处理器
      for (const mediaFile of mediaFiles) {
        await this.addMediaFileToBatch(mediaFile, artwork)
        processedFiles++
      }

      this.logger.debug(
        {
          artworkId,
          title: artwork.title,
          mediaFiles: mediaFiles.length
        },
        'Processed media files for artwork'
      )
    }

    return processedFiles
  }

  /**
   * 添加媒体文件到批量处理器
   * @param mediaFile 媒体文件
   * @param artwork 作品信息
   */
  private async addMediaFileToBatch(
    mediaFile: MediaFile,
    artwork: {
      id: number
      title: string
      artist: { name: string } | null
    }
  ): Promise<void> {
    try {
      // 获取图片尺寸信息（如果可能）
      const { width, height } = await this.getImageDimensions(mediaFile.path)

      const imageData: ImageData & { artworkTitle: string; artistName: string } = {
        path: mediaFile.path,
        size: mediaFile.size,
        width,
        height,
        sortOrder: mediaFile.pageNumber || 0,
        artworkId: artwork.id,
        artworkTitle: artwork.title,
        artistName: artwork.artist?.name || 'Unknown Artist'
      }

      this.batchProcessor.addImage(imageData)
    } catch (error) {
      this.logger.error({ mediaFile, error }, 'Failed to add media file to batch')
    }
  }

  /**
   * 获取图片尺寸信息
   * @param imagePath 图片路径
   * @returns 图片尺寸
   */
  private async getImageDimensions(imagePath: string): Promise<{ width?: number; height?: number }> {
    // 这里可以使用图片处理库来获取尺寸信息
    // 为了简化，暂时返回undefined
    // 在实际实现中，可以使用 sharp 或其他图片处理库
    return { width: undefined, height: undefined }
  }

  /**
   * 更新作品的图片数量
   */
  private async updateArtworkImageCounts(): Promise<void> {
    try {
      // 使用原生SQL更新图片数量，提高性能
      await this.prisma.$executeRaw`
        UPDATE "Artwork" 
        SET "imageCount" = (
          SELECT COUNT(*) 
          FROM "Image" 
          WHERE "Image"."artworkId" = "Artwork"."id"
        )
        WHERE "id" IN (
          SELECT DISTINCT "artworkId" 
          FROM "Image" 
          WHERE "artworkId" IS NOT NULL
        )
      `

      this.logger.info('Updated artwork image counts')
    } catch (error) {
      this.logger.error({ error }, 'Failed to update artwork image counts')
    }
  }
}
