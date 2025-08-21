import { promises as fs } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import {
  ExtendedScanOptions,
  ExtendedScanResult,
  IScanStrategy,
  ValidationResult,
  ArtworkMetadata
} from '@pixishelf/shared'
import { MetadataParser } from './MetadataParser'
import { PathParser } from './PathParser'
import { FileAssociator } from './FileAssociator'
import { BatchProcessor } from './BatchProcessor'
import { ConcurrencyController } from './ConcurrencyController'
import { ArtistData, ArtworkData } from './types'

/**
 * 元数据扫描策略实现
 * 负责扫描和解析元数据文件，创建艺术家和作品记录
 */
export class MetadataScanStrategy implements IScanStrategy {
  readonly name = 'metadata'
  readonly description = 'Scan and parse metadata files to create artwork records'

  private metadataParser: MetadataParser
  private pathParser: PathParser
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
    this.metadataParser = new MetadataParser()
    this.pathParser = new PathParser()
    this.fileAssociator = new FileAssociator()
    this.batchProcessor = new BatchProcessor(prisma, logger)
    this.concurrencyController = new ConcurrencyController(options.maxConcurrency || 4)
  }

  /**
   * 执行元数据扫描策略
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
      this.logger.info({ scanPath: options.scanPath }, 'Starting metadata scan')

      // 1. 查找所有元数据文件
      const metadataFiles = await this.findMetadataFiles(options.scanPath)
      result.metadataFiles = metadataFiles.length

      this.logger.info({ count: metadataFiles.length }, 'Found metadata files')

      if (metadataFiles.length === 0) {
        this.logger.warn('No metadata files found')
        return result
      }

      // 2. 并发处理元数据文件
      const processedCount = await this.processMetadataFiles(metadataFiles, result, options.onProgress)

      result.processedMetadata = processedCount

      // 3. 批量写入数据库
      if (processedCount > 0) {
        this.logger.info('Writing batch data to database')

        const batchResult = await this.batchProcessor.flush()
        result.newArtworks = batchResult.artworksCreated
        result.scannedDirectories = new Set(metadataFiles.map((f) => path.dirname(f))).size

        this.logger.info(
          {
            artworks: result.newArtworks,
            directories: result.scannedDirectories
          },
          'Metadata scan completed'
        )
      }

      return result
    } catch (error) {
      this.logger.error({ error }, 'Metadata scan failed')
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
      // 估算每个元数据文件处理时间约100ms
      return metadataFiles.length * 100
    } catch {
      return 0
    }
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
   * 并发处理元数据文件
   * @param metadataFiles 元数据文件路径数组
   * @param result 扫描结果对象
   * @param onProgress 进度回调
   * @returns 处理成功的文件数量
   */
  private async processMetadataFiles(
    metadataFiles: string[],
    result: ExtendedScanResult,
    onProgress?: (progress: any) => void
  ): Promise<number> {
    let processedCount = 0

    const tasks = metadataFiles.map((filePath) => async () => {
      try {
        await this.processMetadataFile(filePath)
        processedCount++

        // 更新进度
        if (onProgress) {
          onProgress({
            phase: 'scanning',
            message: `Processing metadata files: ${processedCount}/${metadataFiles.length}`,
            current: processedCount,
            total: metadataFiles.length,
            percentage: Math.round((processedCount / metadataFiles.length) * 100)
          })
        }
      } catch (error) {
        this.logger.error({ filePath, error }, 'Failed to process metadata file')
        result.errors.push(`Failed to process ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'}`)
        result.skippedMetadata?.push({
          path: filePath,
          reason: error instanceof Error ? error.message : 'Unknown error'
        })
      }
    })

    await this.concurrencyController.executeAll(tasks)
    return processedCount
  }

  /**
   * 处理单个元数据文件
   * @param filePath 元数据文件路径
   */
  private async processMetadataFile(filePath: string): Promise<void> {
    // 1. 解析元数据
    const metadata = await this.metadataParser.parse(filePath)

    // 2. 解析路径信息
    const dirPath = path.dirname(filePath)
    const artistInfo = this.pathParser.parseArtistInfo(dirPath)
    const artworkInfo = this.pathParser.parseArtworkInfo(dirPath)

    // 3. 创建艺术家数据
    const artistData: ArtistData = {
      name: metadata.user,
      username: artistInfo.username || metadata.user,
      userId: metadata.userId
    }

    // 添加艺术家到批量处理器
    this.batchProcessor.addArtist(artistData)

    // 4. 创建作品数据
    const artworkData: ArtworkData & { artistName: string } = {
      title: metadata.title,
      description: metadata.description,
      artistId: 0, // 将在批量处理时设置
      artistName: metadata.user, // 用于批量处理时的关联
      directoryCreatedAt: artworkInfo.relativePath ? new Date() : undefined,
      imageCount: 0, // 将在媒体扫描时更新
      descriptionLength: metadata.description?.length || 0,

      // 新增的元数据字段
      externalId: metadata.id,
      sourceUrl: metadata.url,
      originalUrl: metadata.originalUrl,
      thumbnailUrl: metadata.thumbnailUrl,
      xRestrict: metadata.xRestrict,
      isAiGenerated: metadata.ai,
      size: metadata.size,
      bookmarkCount: metadata.bookmark,
      sourceDate: metadata.date
    }

    // 添加作品到批量处理器
    this.batchProcessor.addArtwork(artworkData)

    // 5. 处理标签
    if (metadata.tags && metadata.tags.length > 0) {
      for (const tagName of metadata.tags) {
        // 添加标签
        this.batchProcessor.addTag({ name: tagName })

        // 添加作品标签关联
        this.batchProcessor.addArtworkTag(metadata.title, metadata.user, tagName)
      }
    }

    this.logger.debug(
      {
        filePath,
        artworkId: metadata.id,
        title: metadata.title,
        artist: metadata.user,
        tags: metadata.tags?.length || 0
      },
      'Processed metadata file'
    )
  }
}
