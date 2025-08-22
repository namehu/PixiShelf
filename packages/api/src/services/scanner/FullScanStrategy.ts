import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import { ExtendedScanOptions, ExtendedScanResult, IScanStrategy, ValidationResult } from '@pixishelf/shared'
import { MetadataScanStrategy } from './MetadataScanStrategy'
import { MediaScanStrategy } from './MediaScanStrategy'

/**
 * 完整扫描策略实现
 * 组合元数据扫描和媒体文件扫描策略
 */
export class FullScanStrategy implements IScanStrategy {
  readonly name = 'full'
  readonly description = 'Complete scan including metadata and media files'

  private metadataStrategy: MetadataScanStrategy
  private mediaStrategy: MediaScanStrategy

  constructor(
    private prisma: PrismaClient,
    private logger: FastifyInstance['log'],
    private options: {
      maxConcurrency?: number
      batchSize?: number
    } = {}
  ) {
    this.metadataStrategy = new MetadataScanStrategy(prisma, logger, options)
    this.mediaStrategy = new MediaScanStrategy(prisma, logger, options)
  }

  /**
   * 执行完整扫描策略
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
      this.logger.info({ scanPath: options.scanPath }, 'Starting full scan')

      // 阶段1: 元数据扫描
      this.logger.info('Phase 1: Scanning metadata files')

      const metadataResult = await this.metadataStrategy.execute({
        ...options,
        onProgress: (progress) => {
          // 元数据扫描占总进度的70%
          const adjustedProgress = {
            ...progress,
            message: `Phase 1/2: ${progress.message}`,
            percentage: Math.round((progress.percentage || 0) * 0.7)
          }
          options.onProgress?.(adjustedProgress)
        }
      })

      // 合并元数据扫描结果
      this.mergeResults(result, metadataResult, 1.0)

      this.logger.info(
        {
          artworks: result.newArtworks,
          metadataFiles: result.metadataFiles
        },
        'Phase 1 completed: Metadata scan'
      )

      // 决定是否执行第二阶段
      const shouldSkipMediaScan = await this.shouldSkipMediaScan(options, result)
      if (shouldSkipMediaScan.skip) {
        this.logger.warn(shouldSkipMediaScan.reason)
        return result
      }

      // 阶段2: 媒体文件扫描
      this.logger.info('Phase 2: Scanning media files')

      const mediaResult = await this.mediaStrategy.execute({
        ...options,
        onProgress: (progress) => {
          // 媒体扫描占总进度的30%，从70%开始
          const adjustedProgress = {
            ...progress,
            message: `Phase 2/2: ${progress.message}`,
            percentage: Math.round(70 + (progress.percentage || 0) * 0.3)
          }
          options.onProgress?.(adjustedProgress)
        }
      })

      // 合并媒体扫描结果
      this.mergeResults(result, mediaResult, 0.0) // 不重复计算目录和作品数

      this.logger.info(
        {
          artworks: result.newArtworks,
          images: result.newImages,
          directories: result.scannedDirectories
        },
        'Phase 2 completed: Media scan'
      )

      // 最终进度更新
      options.onProgress?.({
        phase: 'complete',
        message: `Full scan completed: ${result.newArtworks} artworks, ${result.newImages} images`,
        percentage: 100
      })

      this.logger.info(
        {
          totalArtworks: result.newArtworks,
          totalImages: result.newImages,
          totalDirectories: result.scannedDirectories,
          totalErrors: result.errors.length
        },
        'Full scan completed'
      )

      return result
    } catch (error) {
      this.logger.error({ error }, 'Full scan failed')
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
    // 使用元数据策略的验证逻辑
    return this.metadataStrategy.validate(options)
  }

  /**
   * 估算扫描时长
   * @param options 扫描选项
   * @returns 预估时长（毫秒）
   */
  async getEstimatedDuration(options: ExtendedScanOptions): Promise<number> {
    try {
      // 获取两个策略的估算时长并相加
      const [metadataDuration, mediaDuration] = await Promise.all([
        this.metadataStrategy.getEstimatedDuration(options),
        this.mediaStrategy.getEstimatedDuration(options)
      ])

      return metadataDuration + mediaDuration
    } catch {
      return 0
    }
  }

  /**
   * 合并扫描结果
   * @param target 目标结果对象
   * @param source 源结果对象
   * @param directoryMultiplier 目录数量乘数（避免重复计算）
   */
  private mergeResults(target: ExtendedScanResult, source: ExtendedScanResult, directoryMultiplier: number): void {
    // 累加数值字段
    target.scannedDirectories += Math.round(source.scannedDirectories * directoryMultiplier)
    target.foundImages += source.foundImages
    target.newArtworks += source.newArtworks
    target.newImages += source.newImages
    target.removedArtworks = (target.removedArtworks || 0) + (source.removedArtworks || 0)

    // 合并元数据相关字段
    if (source.metadataFiles !== undefined) {
      target.metadataFiles = (target.metadataFiles || 0) + source.metadataFiles
    }
    if (source.processedMetadata !== undefined) {
      target.processedMetadata = (target.processedMetadata || 0) + source.processedMetadata
    }

    // 合并错误和跳过的项目
    target.errors.push(...source.errors)

    if (source.skippedDirectories) {
      if (!target.skippedDirectories) {
        target.skippedDirectories = []
      }
      target.skippedDirectories.push(...source.skippedDirectories)
    }

    if (source.skippedMetadata) {
      if (!target.skippedMetadata) {
        target.skippedMetadata = []
      }
      target.skippedMetadata.push(...source.skippedMetadata)
    }
  }

  /**
   * 获取策略统计信息
   * @returns 策略统计
   */
  getStrategyStats(): {
    metadataStrategy: string
    mediaStrategy: string
    totalStrategies: number
  } {
    return {
      metadataStrategy: this.metadataStrategy.name,
      mediaStrategy: this.mediaStrategy.name,
      totalStrategies: 2
    }
  }

  /**
   * 判断是否应该跳过媒体扫描阶段
   * @param options 扫描选项
   * @param result 第一阶段结果
   * @returns 是否跳过及原因
   */
  private async shouldSkipMediaScan(
    options: ExtendedScanOptions, 
    result: ExtendedScanResult
  ): Promise<{ skip: boolean; reason?: string }> {
    // 强制扫描模式：始终执行两个阶段
    if (options.forceUpdate) {
      this.logger.info('Force scan mode: executing media scan regardless of metadata results')
      return { skip: false }
    }

    // 增量扫描模式：根据第一阶段结果决定
    if (result.newArtworks === 0) {
      // 检查数据库中是否已有作品
      return await this.checkExistingArtworks()
    }

    return { skip: false }
  }

  /**
   * 检查数据库中是否存在作品
   * @returns 是否跳过及原因
   */
  private async checkExistingArtworks(): Promise<{ skip: boolean; reason?: string }> {
    try {
      const existingCount = await this.prisma.artwork.count({ take: 1 })
      
      if (existingCount === 0) {
        return {
          skip: true,
          reason: 'No artworks created from metadata scan and no existing artworks in database, skipping media scan'
        }
      }
      
      this.logger.info('No new artworks from metadata scan, but existing artworks found - proceeding with media scan for potential new images')
      return { skip: false }
    } catch (error) {
      this.logger.error({ error }, 'Failed to check existing artworks, proceeding with media scan')
      return { skip: false }
    }
  }

  /**
   * 检查策略是否可用
   * @param options 扫描选项
   * @returns 策略可用性检查结果
   */
  async checkAvailability(options: ExtendedScanOptions): Promise<{
    metadataAvailable: boolean
    mediaAvailable: boolean
    overallAvailable: boolean
    issues: string[]
  }> {
    const issues: string[] = []

    // 检查元数据策略
    const metadataValidation = this.metadataStrategy.validate(options)
    const metadataAvailable = metadataValidation.isValid
    if (!metadataAvailable) {
      issues.push(...metadataValidation.errors.map((e) => `Metadata: ${e}`))
    }

    // 检查媒体策略
    const mediaValidation = this.mediaStrategy.validate(options)
    const mediaAvailable = mediaValidation.isValid
    if (!mediaAvailable) {
      issues.push(...mediaValidation.errors.map((e) => `Media: ${e}`))
    }

    return {
      metadataAvailable,
      mediaAvailable,
      overallAvailable: metadataAvailable && mediaAvailable,
      issues
    }
  }
}
