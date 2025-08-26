import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import {
  ExtendedScanOptions,
  ExtendedScanResult,
  IScanStrategy,
  ExtendedValidationResult,
  UnifiedScanOptions,
  ProcessProgress,
  ProcessResult
} from '@pixishelf/shared'
import { PipelineProcessor } from './PipelineProcessor'
import { PerformanceMonitor } from './PerformanceMonitor'
import { ProgressTracker } from './ProgressTracker'

/**
 * 统一扫描策略实现
 * 将元数据扫描和媒体文件扫描统一在一个流水线中处理
 */
export class UnifiedScanStrategy implements IScanStrategy {
  readonly name = 'unified'
  readonly description = 'Unified scan processing metadata and media files together in a pipeline'

  private pipelineProcessor: PipelineProcessor
  private performanceMonitor: PerformanceMonitor
  private progressTracker: ProgressTracker
  private logger: FastifyInstance['log']
  private prisma: PrismaClient
  private options: UnifiedScanOptions

  constructor(prisma: PrismaClient, logger: FastifyInstance['log'], options: UnifiedScanOptions = {}) {
    this.prisma = prisma
    this.logger = logger
    this.options = {
      maxConcurrency: options.maxConcurrency || 4,
      batchSize: options.batchSize || 50,
      streamBufferSize: options.streamBufferSize || 100,
      memoryThreshold: options.memoryThreshold || 1024 * 1024 * 1024 // 1GB
    }

    this.pipelineProcessor = new PipelineProcessor(prisma, logger, {
      maxConcurrency: this.options.maxConcurrency,
      batchSize: this.options.batchSize
    })
    this.performanceMonitor = new PerformanceMonitor(logger)
    this.progressTracker = new ProgressTracker(logger)
  }

  /**
   * 执行统一扫描策略
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async execute(options: ExtendedScanOptions): Promise<ExtendedScanResult> {
    const result: ExtendedScanResult = this.initializeResult()

    try {
      this.logger.info(
        {
          scanPath: options.scanPath,
          strategy: this.name,
          options: this.options
        },
        'Starting unified scan'
      )

      // 1. 初始化性能监控
      this.performanceMonitor.startMonitoring()

      // 2. 执行流水线处理
      const processResult = await this.pipelineProcessor.processFiles(options.scanPath, {
        onProgress: (progress) => this.handleProgress(progress, options),
        onError: (error) => this.handleError(error, result),
        batchSize: this.options.batchSize,
        maxConcurrency: this.options.maxConcurrency
      })

      // 3. 合并结果
      this.mergeResults(result, processResult)

      // 4. 生成性能报告
      const performanceReport = this.performanceMonitor.getPerformanceReport()
      // 注意：ExtendedScanResult 不包含 performance 字段，这里先注释掉
      // result.performance = {
      //   duration: Date.now() - startTime,
      //   strategy: this.name,
      //   performanceMetrics: performanceReport,
      //   concurrencyStats: {
      //     maxConcurrency: this.options.maxConcurrency,
      //     running: 0,
      //     queued: 0,
      //     total: processResult.processedFiles
      //   }
      // }

      this.logger.info(
        {
          strategy: this.name,
          result: {
            scannedDirectories: result.scannedDirectories,
            foundImages: result.foundImages,
            newArtworks: result.newArtworks,
            newImages: result.newImages,
            errors: result.errors.length
          }
          // performance: result.performance // 已注释掉
        },
        'Unified scan completed successfully'
      )

      return result
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger.error(
        {
          strategy: this.name,
          scanPath: options.scanPath,
          error: errorMessage
        },
        'Unified scan failed'
      )

      result.errors.push(`Unified scan failed: ${errorMessage}`)
      return result
    } finally {
      this.performanceMonitor.stopMonitoring()
    }
  }

  /**
   * 验证扫描选项
   * @param options 扫描选项
   * @returns 验证结果
   */
  validate(options: ExtendedScanOptions): ExtendedValidationResult {
    const validation: ExtendedValidationResult = {
      isValid: true,
      errors: [],
      warnings: []
    }

    // 验证扫描路径
    if (!options.scanPath) {
      validation.errors.push('Scan path is required')
    }

    // 验证并发数
    if (this.options.maxConcurrency && this.options.maxConcurrency < 1) {
      validation.errors.push('Max concurrency must be at least 1')
    }

    // 验证批处理大小
    if (this.options.batchSize && this.options.batchSize < 1) {
      validation.errors.push('Batch size must be at least 1')
    }

    // 验证内存阈值
    if (this.options.memoryThreshold && this.options.memoryThreshold < 100 * 1024 * 1024) {
      validation.warnings.push('Memory threshold is very low, may cause frequent memory pressure')
    }

    validation.isValid = validation.errors.length === 0
    return validation
  }

  /**
   * 获取预估持续时间
   * @param options 扫描选项
   * @returns 预估持续时间（毫秒）
   */
  async getEstimatedDuration(options: ExtendedScanOptions): Promise<number> {
    try {
      // 简单估算：假设每个文件平均处理时间为100ms
      const avgProcessingTime = 100 // 毫秒

      // 这里可以实现更复杂的估算逻辑
      // 比如基于历史数据、文件大小等

      // 暂时返回一个基础估算
      return avgProcessingTime * 100 // 假设100个文件
    } catch (error) {
      this.logger.error({ error }, 'Failed to estimate duration')
      return 30000 // 默认30秒
    }
  }

  /**
   * 处理进度更新
   * @param progress 处理进度
   * @param options 扫描选项
   */
  private handleProgress(progress: ProcessProgress, options: ExtendedScanOptions): void {
    const unifiedProgress = {
      phase: 'scanning',
      message: `Processing artworks: ${progress.processed}/${progress.total}`,
      current: progress.processed,
      total: progress.total,
      percentage: Math.round((progress.processed / progress.total) * 100)
    }

    // 调用外部进度回调
    const scanProgress = {
      phase: 'scanning' as const,
      message: unifiedProgress.message,
      current: unifiedProgress.current,
      total: unifiedProgress.total,
      percentage: unifiedProgress.percentage
    }
    options.onProgress?.(scanProgress)
  }

  /**
   * 处理错误
   * @param error 错误对象
   * @param result 扫描结果
   */
  private handleError(error: Error, result: ExtendedScanResult): void {
    const errorMessage = error.message || 'Unknown error'
    this.logger.error({ error: errorMessage }, 'Error during unified scan')
    result.errors.push(errorMessage)
  }

  /**
   * 合并处理结果到扫描结果
   * @param target 目标扫描结果
   * @param source 源处理结果
   */
  private mergeResults(target: ExtendedScanResult, source: ProcessResult): void {
    target.scannedDirectories = source.scannedDirectories
    target.foundImages = source.foundImages
    target.newArtworks = source.newArtworks
    target.newImages = source.newImages
    target.errors.push(...source.errors)
    target.skippedDirectories = source.skippedDirectories.map((dir) => ({ path: dir, reason: 'Processing failed' }))
    target.metadataFiles = source.metadataFiles
    target.processedMetadata = source.processedMetadata
    target.skippedMetadata = source.skippedMetadata.map((meta) => ({ path: meta, reason: 'Processing failed' }))
  }

  /**
   * 初始化扫描结果
   * @returns 初始化的扫描结果
   */
  private initializeResult(): ExtendedScanResult {
    return {
      scannedDirectories: 0,
      foundImages: 0,
      newArtworks: 0,
      newImages: 0,
      errors: [],
      skippedDirectories: [],
      metadataFiles: 0,
      processedMetadata: 0,
      skippedMetadata: [],
      removedArtworks: 0
    }
  }

  /**
   * 检查统一扫描是否适用
   * @param options 扫描选项
   * @returns 是否适用
   */
  async isUnifiedScanSuitable(options: ExtendedScanOptions): Promise<boolean> {
    try {
      // 检查是否有元数据文件
      const hasMetadataFiles = await this.hasMetadataFiles(options.scanPath)

      // 检查系统资源
      const hasAdequateMemory = this.checkMemoryAvailability()

      return hasMetadataFiles && hasAdequateMemory
    } catch (error) {
      this.logger.error({ error }, 'Failed to check unified scan suitability')
      return false
    }
  }

  /**
   * 检查是否有元数据文件
   * @param scanPath 扫描路径
   * @returns 是否有元数据文件
   */
  private async hasMetadataFiles(scanPath: string): Promise<boolean> {
    try {
      const fs = await import('fs/promises')
      const path = await import('path')

      const checkDirectory = async (dirPath: string): Promise<boolean> => {
        try {
          const entries = await fs.readdir(dirPath, { withFileTypes: true })

          for (const entry of entries) {
            if (entry.isFile() && entry.name.endsWith('-meta.txt')) {
              return true
            } else if (entry.isDirectory()) {
              const hasMetaInSubdir = await checkDirectory(path.join(dirPath, entry.name))
              if (hasMetaInSubdir) {
                return true
              }
            }
          }

          return false
        } catch {
          return false
        }
      }

      return await checkDirectory(scanPath)
    } catch (error) {
      this.logger.error({ error, scanPath }, 'Failed to check for metadata files')
      return false
    }
  }

  /**
   * 检查内存可用性
   * @returns 内存是否充足
   */
  private checkMemoryAvailability(): boolean {
    try {
      const usage = process.memoryUsage()
      const availableMemory = usage.heapTotal - usage.heapUsed

      // 检查是否有足够的可用内存（至少512MB）
      return availableMemory > 512 * 1024 * 1024
    } catch (error) {
      this.logger.error({ error }, 'Failed to check memory availability')
      return true // 默认认为内存充足
    }
  }

  /**
   * 获取策略统计信息
   * @returns 策略统计
   */
  getStrategyStats(): {
    name: string
    description: string
    options: UnifiedScanOptions
    isActive: boolean
  } {
    return {
      name: this.name,
      description: this.description,
      options: this.options,
      isActive: this.performanceMonitor.getCurrentMetrics() !== null
    }
  }
}
