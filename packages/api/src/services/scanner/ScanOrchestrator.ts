import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import {
  ExtendedScanOptions,
  ExtendedScanResult,
  IScanOrchestrator,
  IScanStrategy,
  ScanStrategyType,
  ScanOrchestratorOptions,
  UnsupportedStrategyError,
  ValidationResult
} from '@pixishelf/shared'
import { MetadataScanStrategy } from './MetadataScanStrategy'
import { MediaScanStrategy } from './MediaScanStrategy'
import { FullScanStrategy } from './FullScanStrategy'
import { PerformanceMonitor } from './PerformanceMonitor'
import { ProgressTracker } from './ProgressTracker'
import { ConcurrencyController } from './ConcurrencyController'

/**
 * 扫描编排器实现
 * 负责协调不同的扫描策略和性能组件
 */
export class ScanOrchestrator implements IScanOrchestrator {
  private strategies: Map<ScanStrategyType, IScanStrategy>
  private currentStrategy: IScanStrategy | null = null
  private performanceMonitor!: PerformanceMonitor
  private progressTracker: ProgressTracker | null = null
  private concurrencyController!: ConcurrencyController

  constructor(
    private prisma: PrismaClient,
    private logger: FastifyInstance['log'],
    private options: ScanOrchestratorOptions = {}
  ) {
    this.strategies = new Map()
    this.initializeStrategies()
    this.initializePerformanceComponents()
  }

  /**
   * 执行扫描
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async scan(options: ExtendedScanOptions): Promise<ExtendedScanResult> {
    const startTime = Date.now()

    try {
      // 1. 选择扫描策略
      this.selectStrategy(options.scanType)

      if (!this.currentStrategy) {
        throw new Error('No scan strategy selected')
      }

      // 2. 验证扫描选项
      const validation = this.currentStrategy.validate(options)
      if (!validation.isValid) {
        throw new Error(`Validation failed: ${validation.errors.join(', ')}`)
      }

      // 3. 初始化性能跟踪
      await this.initializePerformanceTracking(options)

      this.logger.info(
        {
          strategy: this.currentStrategy.name,
          scanPath: options.scanPath,
          scanType: options.scanType
        },
        'Starting scan with orchestrator'
      )

      // 4. 执行扫描
      const result = await this.currentStrategy.execute({
        ...options,
        onProgress: (progress) => {
          // 包装进度回调以添加性能监控
          this.handleProgress(progress)
          options.onProgress?.(progress)
        }
      })

      // 5. 生成性能报告
      const performanceReport = await this.generatePerformanceReport(startTime)

      this.logger.info(
        {
          strategy: this.currentStrategy.name,
          result,
          performance: performanceReport
        },
        'Scan completed successfully'
      )

      return result
    } catch (error) {
      this.logger.error(
        {
          strategy: this.currentStrategy?.name,
          error,
          duration: Date.now() - startTime
        },
        'Scan failed'
      )

      throw error
    } finally {
      // 清理资源
      this.cleanup()
    }
  }

  /**
   * 获取支持的策略列表
   * @returns 策略名称数组
   */
  getSupportedStrategies(): string[] {
    return Array.from(this.strategies.keys())
  }

  /**
   * 设置扫描策略
   * @param strategy 策略类型
   */
  setStrategy(strategy: ScanStrategyType): void {
    if (!this.strategies.has(strategy)) {
      throw new UnsupportedStrategyError(strategy)
    }

    this.currentStrategy = this.strategies.get(strategy)!
    this.logger.debug({ strategy }, 'Scan strategy set')
  }

  /**
   * 获取当前策略信息
   * @returns 当前策略信息
   */
  getCurrentStrategy(): {
    name: string
    description: string
  } | null {
    if (!this.currentStrategy) {
      return null
    }

    return {
      name: this.currentStrategy.name,
      description: this.currentStrategy.description
    }
  }

  /**
   * 估算扫描时长
   * @param options 扫描选项
   * @param strategyType 策略类型
   * @returns 预估时长（毫秒）
   */
  async estimateDuration(options: ExtendedScanOptions, strategyType?: ScanStrategyType): Promise<number> {
    const strategy = strategyType ? this.strategies.get(strategyType) : this.currentStrategy

    if (!strategy) {
      return 0
    }

    try {
      return await strategy.getEstimatedDuration(options)
    } catch {
      return 0
    }
  }

  /**
   * 检查策略可用性
   * @param options 扫描选项
   * @returns 可用性检查结果
   */
  async checkStrategyAvailability(options: ExtendedScanOptions): Promise<{
    [K in ScanStrategyType]: {
      available: boolean
      issues: string[]
      estimatedDuration: number
    }
  }> {
    const results = {} as any

    for (const [strategyType, strategy] of this.strategies) {
      const validation = strategy.validate(options)
      const estimatedDuration = await strategy.getEstimatedDuration(options).catch(() => 0)

      results[strategyType] = {
        available: validation.isValid,
        issues: validation.errors,
        estimatedDuration
      }
    }

    return results
  }

  /**
   * 智能选择最佳策略
   * @param options 扫描选项
   * @returns 推荐的策略类型
   */
  async recommendStrategy(options: ExtendedScanOptions): Promise<{
    recommended: ScanStrategyType
    reason: string
    alternatives: Array<{
      strategy: ScanStrategyType
      reason: string
    }>
  }> {
    const availability = await this.checkStrategyAvailability(options)
    const alternatives: Array<{ strategy: ScanStrategyType; reason: string }> = []

    // 检查是否有元数据文件
    const hasMetadataFiles = await this.hasMetadataFiles(options.scanPath)

    if (hasMetadataFiles) {
      // 如果有元数据文件，推荐完整扫描
      if (availability.full.available) {
        alternatives.push(
          { strategy: 'metadata', reason: 'Only scan metadata files' },
          { strategy: 'media', reason: 'Only scan media files (requires existing artworks)' }
        )

        return {
          recommended: 'full',
          reason: 'Metadata files detected, full scan will process both metadata and media files',
          alternatives
        }
      } else {
        // 如果完整扫描不可用，尝试元数据扫描
        if (availability.metadata.available) {
          return {
            recommended: 'metadata',
            reason: 'Metadata files detected, but full scan not available',
            alternatives: []
          }
        }
      }
    }

    // 检查数据库中是否有作品
    const hasArtworks = await this.hasExistingArtworks()

    if (hasArtworks && availability.media.available) {
      return {
        recommended: 'media',
        reason: 'No metadata files found, but existing artworks in database',
        alternatives: []
      }
    }

    // 默认推荐传统扫描（如果实现了的话）
    return {
      recommended: 'full',
      reason: 'Default recommendation',
      alternatives: []
    }
  }

  /**
   * 初始化扫描策略
   */
  private initializeStrategies(): void {
    const strategyOptions = {
      maxConcurrency: this.options.maxConcurrency || 4,
      batchSize: 1000
    }

    this.strategies.set('metadata', new MetadataScanStrategy(this.prisma, this.logger, strategyOptions))
    this.strategies.set('media', new MediaScanStrategy(this.prisma, this.logger, strategyOptions))
    this.strategies.set('full', new FullScanStrategy(this.prisma, this.logger, strategyOptions))

    // 设置默认策略
    const defaultStrategy = this.options.defaultStrategy || 'full'
    if (this.strategies.has(defaultStrategy)) {
      this.currentStrategy = this.strategies.get(defaultStrategy)!
    }

    this.logger.debug(
      {
        strategies: Array.from(this.strategies.keys()),
        defaultStrategy
      },
      'Scan strategies initialized'
    )
  }

  /**
   * 初始化性能组件
   */
  private initializePerformanceComponents(): void {
    this.performanceMonitor = new PerformanceMonitor(this.logger)
    this.concurrencyController = new ConcurrencyController(this.options.maxConcurrency || 4)

    this.logger.debug('Performance components initialized')
  }

  /**
   * 选择扫描策略
   * @param scanType 扫描类型
   */
  private selectStrategy(scanType?: ScanStrategyType): void {
    if (!scanType) {
      // 使用当前策略或默认策略
      if (!this.currentStrategy) {
        this.currentStrategy = this.strategies.get('full')!
      }
      return
    }

    if (!this.strategies.has(scanType)) {
      throw new UnsupportedStrategyError(scanType)
    }

    this.currentStrategy = this.strategies.get(scanType)!
  }

  /**
   * 初始化性能跟踪
   * @param options 扫描选项
   */
  private async initializePerformanceTracking(options: ExtendedScanOptions): Promise<void> {
    this.progressTracker = new ProgressTracker(this.logger, options.onProgress, (detailedProgress) => {
      this.logger.debug({ detailedProgress }, 'Detailed progress update')
    })

    this.performanceMonitor.startMonitoring()
  }

  /**
   * 处理进度更新
   * @param progress 进度信息
   */
  private handleProgress(progress: any): void {
    if (this.progressTracker) {
      // 这里可以添加进度处理逻辑
      this.performanceMonitor.updateProgress()
    }
  }

  /**
   * 生成性能报告
   * @param startTime 开始时间
   * @returns 性能报告
   */
  private async generatePerformanceReport(startTime: number): Promise<any> {
    const endTime = Date.now()
    const duration = endTime - startTime

    return {
      duration,
      strategy: this.currentStrategy?.name,
      performanceMetrics: this.performanceMonitor.getCurrentMetrics(),
      concurrencyStats: this.concurrencyController.getStatus()
    }
  }

  /**
   * 清理资源
   */
  private cleanup(): void {
    if (this.performanceMonitor) {
      this.performanceMonitor.stopMonitoring()
    }

    if (this.progressTracker) {
      this.progressTracker.stop()
      this.progressTracker = null
    }
  }

  /**
   * 检查是否存在元数据文件
   * @param scanPath 扫描路径
   * @returns 是否存在元数据文件
   */
  private async hasMetadataFiles(scanPath: string): Promise<boolean> {
    try {
      // 这里可以实现快速检查逻辑
      // 为了简化，暂时返回true
      return true
    } catch {
      return false
    }
  }

  /**
   * 检查数据库中是否有现有作品
   * @returns 是否有现有作品
   */
  private async hasExistingArtworks(): Promise<boolean> {
    try {
      const count = await this.prisma.artwork.count({
        where: {
          externalId: {
            not: null
          }
        },
        take: 1
      })

      return count > 0
    } catch {
      return false
    }
  }
}
