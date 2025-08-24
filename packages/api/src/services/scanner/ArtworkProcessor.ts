import path from 'path'
import { FastifyInstance } from 'fastify'
import {
  ArtworkProcessResult,
  ArtworkMetadata,
  PathInfo,
  MediaFile,
  ArtistData,
  ArtworkData,
  ImageData,
  TagData,
  ExtendedValidationResult,
  ProcessContext,
  ProcessingStage
} from '@pixishelf/shared'
import { MetadataParser } from './MetadataParser'
import { PathParser } from './PathParser'
import { FileAssociator } from './FileAssociator'

/**
 * 作品处理器
 * 负责处理单个作品的完整流程：元数据解析 + 媒体文件关联 + 数据生成
 */
export class ArtworkProcessor {
  private metadataParser: MetadataParser
  private pathParser: PathParser
  private fileAssociator: FileAssociator
  private logger: FastifyInstance['log']
  private retryOptions: {
    maxRetries: number
    backoffMs: number
  }

  constructor(logger: FastifyInstance['log']) {
    this.logger = logger
    this.metadataParser = new MetadataParser()
    this.pathParser = new PathParser()
    this.fileAssociator = new FileAssociator()
    this.retryOptions = {
      maxRetries: 3,
      backoffMs: 1000
    }
  }

  /**
   * 处理单个作品
   * @param metadataFile 元数据文件路径
   * @returns 作品处理结果
   */
  async processArtwork(metadataFile: string): Promise<ArtworkProcessResult> {
    const result: ArtworkProcessResult = {
      metadataFile,
      success: false,
      errors: []
    }

    const context: ProcessContext = {
      currentFile: metadataFile,
      stage: ProcessingStage.METADATA_PARSING,
      startTime: Date.now(),
      retryCount: 0,
      data: {}
    }

    try {
      this.logger.debug({ metadataFile }, 'Starting artwork processing')

      // 1. 解析元数据
      context.stage = ProcessingStage.METADATA_PARSING
      const metadata = await this.parseMetadata(metadataFile)
      result.metadata = metadata
      context.data.metadata = metadata

      // 2. 解析路径信息
      const pathInfo = this.pathParser.parseArtworkPath(metadataFile)
      result.pathInfo = pathInfo
      context.data.pathInfo = pathInfo

      // 3. 关联媒体文件
      context.stage = ProcessingStage.MEDIA_ASSOCIATION
      const mediaFiles = await this.associateMediaFiles(metadata, path.dirname(metadataFile))
      result.mediaFiles = mediaFiles
      context.data.mediaFiles = mediaFiles

      // 4. 生成数据
      context.stage = ProcessingStage.DATA_GENERATION
      await this.generateAllData(result, metadata, pathInfo, mediaFiles)

      // 5. 验证数据完整性
      context.stage = ProcessingStage.VALIDATION
      const validation = await this.validateArtworkData(result)
      if (!validation.isValid) {
        result.errors.push(...validation.errors)
        this.logger.warn({
          metadataFile,
          errors: validation.errors,
          warnings: validation.warnings
        }, 'Artwork data validation failed')
        return result
      }

      // 6. 处理成功
      context.stage = ProcessingStage.COMPLETED
      result.success = true
      
      this.logger.debug({
        metadataFile,
        artworkTitle: metadata.title,
        imageCount: mediaFiles.length,
        processingTime: Date.now() - context.startTime
      }, 'Artwork processing completed successfully')

      return result

    } catch (error) {
      context.stage = ProcessingStage.FAILED
      const errorMessage = error instanceof Error ? error.message : String(error)
      result.errors.push(errorMessage)
      
      this.logger.error({
        metadataFile,
        error: errorMessage,
        stage: context.stage,
        processingTime: Date.now() - context.startTime
      }, 'Artwork processing failed')

      return result
    }
  }

  /**
   * 解析元数据文件
   * @param filePath 文件路径
   * @returns 作品元数据
   */
  private async parseMetadata(filePath: string): Promise<ArtworkMetadata> {
    return await this.retryOperation(
      () => this.metadataParser.parseFile(filePath),
      `Failed to parse metadata file: ${filePath}`
    )
  }

  /**
   * 关联媒体文件
   * @param metadata 作品元数据
   * @param basePath 基础路径
   * @returns 媒体文件列表
   */
  private async associateMediaFiles(metadata: ArtworkMetadata, basePath: string): Promise<MediaFile[]> {
    return await this.retryOperation(
      () => this.fileAssociator.findMediaFiles(basePath, metadata.id),
      `Failed to associate media files for artwork: ${metadata.id}`
    )
  }

  /**
   * 生成所有数据
   * @param result 处理结果
   * @param metadata 元数据
   * @param pathInfo 路径信息
   * @param mediaFiles 媒体文件
   */
  private async generateAllData(
    result: ArtworkProcessResult,
    metadata: ArtworkMetadata,
    pathInfo: PathInfo,
    mediaFiles: MediaFile[]
  ): Promise<void> {
    // 生成艺术家数据
    result.artist = this.generateArtistData(metadata, pathInfo)
    
    // 生成作品数据
    result.artwork = this.generateArtworkData(metadata, pathInfo, mediaFiles.length)
    
    // 生成图片数据
    result.images = this.generateImageData(mediaFiles, metadata)
    
    // 生成标签数据
    result.tags = this.generateTagData(metadata)
  }

  /**
   * 生成艺术家数据
   * @param metadata 作品元数据
   * @param pathInfo 路径信息
   * @returns 艺术家数据
   */
  private generateArtistData(metadata: ArtworkMetadata, pathInfo: PathInfo): ArtistData {
    return {
      name: metadata.user,
      username: metadata.user,
      userId: metadata.userId,
      avatarUrl: undefined, // 从元数据中无法获取
      bio: undefined, // 从元数据中无法获取
      socialLinks: metadata.url ? { pixiv: metadata.url } : undefined
    }
  }

  /**
   * 生成作品数据
   * @param metadata 作品元数据
   * @param pathInfo 路径信息
   * @param imageCount 图片数量
   * @returns 作品数据
   */
  private generateArtworkData(
    metadata: ArtworkMetadata,
    pathInfo: PathInfo,
    imageCount: number
  ): ArtworkData {
    return {
      title: metadata.title,
      description: metadata.description,
      externalId: metadata.id,
      sourceUrl: metadata.url,
      originalUrl: metadata.originalUrl,
      thumbnailUrl: metadata.thumbnailUrl,
      xRestrict: metadata.xRestrict,
      isAiGenerated: metadata.ai,
      size: metadata.size,
      bookmarkCount: metadata.bookmark,
      sourceDate: metadata.date,
      imageCount,
      createdAt: new Date(),
      updatedAt: new Date()
    }
  }

  /**
   * 生成图片数据
   * @param mediaFiles 媒体文件列表
   * @param metadata 作品元数据
   * @returns 图片数据列表
   */
  private generateImageData(mediaFiles: MediaFile[], metadata: ArtworkMetadata): ImageData[] {
    return mediaFiles.map(file => ({
      path: file.path,
      filename: file.name,
      extension: file.extension,
      size: file.size,
      pageNumber: file.pageNumber || 0,
      isPrimary: file.pageNumber === 0 || file.pageNumber === 1,
      createdAt: new Date()
    }))
  }

  /**
   * 生成标签数据
   * @param metadata 作品元数据
   * @returns 标签数据列表
   */
  private generateTagData(metadata: ArtworkMetadata): TagData[] {
    if (!metadata.tags || metadata.tags.length === 0) {
      return []
    }

    return metadata.tags.map(tag => ({
      name: tag.trim(),
      type: 'artwork', // 默认类型
      count: 1 // 初始计数
    }))
  }

  /**
   * 验证作品数据
   * @param result 作品处理结果
   * @returns 验证结果
   */
  private async validateArtworkData(result: ArtworkProcessResult): Promise<ExtendedValidationResult> {
    const validation: ExtendedValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    }

    // 验证必需的元数据
    if (!result.metadata) {
      validation.errors.push('Missing metadata')
    } else {
      if (!result.metadata.id) {
        validation.errors.push('Missing artwork ID')
      }
      if (!result.metadata.title) {
        validation.errors.push('Missing artwork title')
      }
      if (!result.metadata.user) {
        validation.errors.push('Missing artist name')
      }
      if (!result.metadata.userId) {
        validation.errors.push('Missing artist ID')
      }
    }

    // 验证路径信息
    if (!result.pathInfo) {
      validation.errors.push('Missing path information')
    }

    // 验证媒体文件
    if (!result.mediaFiles || result.mediaFiles.length === 0) {
      validation.warnings.push('No media files found')
    }

    // 验证生成的数据
    if (!result.artist) {
      validation.errors.push('Failed to generate artist data')
    }

    if (!result.artwork) {
      validation.errors.push('Failed to generate artwork data')
    }

    if (!result.images || result.images.length === 0) {
      validation.warnings.push('No image data generated')
    }

    // 验证数据一致性
    if (result.artwork && result.images) {
      if (result.artwork.imageCount !== result.images.length) {
        validation.warnings.push(
          `Image count mismatch: expected ${result.artwork.imageCount}, got ${result.images.length}`
        )
        // 修正图片数量
        result.artwork.imageCount = result.images.length
      }
    }

    // 设置验证结果
    validation.isValid = validation.errors.length === 0

    return validation
  }

  /**
   * 重试操作
   * @param operation 要执行的操作
   * @param errorMessage 错误消息
   * @returns 操作结果
   */
  private async retryOperation<T>(
    operation: () => Promise<T>,
    errorMessage: string
  ): Promise<T> {
    let lastError: Error | null = null

    for (let attempt = 1; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        return await operation()
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error))
        
        if (attempt === this.retryOptions.maxRetries) {
          break
        }

        this.logger.debug({
          attempt,
          maxRetries: this.retryOptions.maxRetries,
          error: lastError.message
        }, 'Operation failed, retrying...')

        // 等待后重试
        await this.delay(this.retryOptions.backoffMs * attempt)
      }
    }

    throw new Error(`${errorMessage}: ${lastError?.message || 'Unknown error'}`)
  }

  /**
   * 延迟函数
   * @param ms 延迟毫秒数
   * @returns Promise<void>
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms))
  }
}