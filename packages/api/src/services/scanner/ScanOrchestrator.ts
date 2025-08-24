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
import { UnifiedScanStrategy } from './UnifiedScanStrategy'
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

    // 优先推荐统一扫描
    if (availability.unified?.available) {
      // 如果有legacy策略可用，添加为备选
      if (availability.legacy?.available) {
        alternatives.push(
          { strategy: 'legacy', reason: 'Traditional scanning approach, stable and reliable' }
        )
      }

      return {
        recommended: 'unified',
        reason: 'Unified scan provides better performance and user experience with continuous processing',
        alternatives
      }
    }

    // 如果统一扫描不可用，回退到legacy策略
    if (availability.legacy?.available) {
      return {
        recommended: 'legacy',
        reason: 'Unified scan not available, using traditional scanning approach',
        alternatives: []
      }
    }

    // 如果都不可用，默认推荐unified（可能会在执行时报错）
    return {
      recommended: 'unified',
      reason: 'Default recommendation (may require troubleshooting if unavailable)',
      alternatives: []
    }
  }

  /**
   * 初始化扫描策略
   */
  private initializeStrategies(): void {
    const unifiedOptions = {
      maxConcurrency: this.options.maxConcurrency || 4,
      batchSize: 1000,
      streamBufferSize: 100,
      memoryThreshold: 1024 * 1024 * 1024 // 1GB
    }

    // 只注册支持的策略：legacy 和 unified
    this.strategies.set('unified', new UnifiedScanStrategy(this.prisma, this.logger, unifiedOptions))
    // TODO: 添加 legacy 策略实现
    // this.strategies.set('legacy', new LegacyStrategy(this.prisma, this.logger, strategyOptions))

    // 设置默认策略为 unified
    const defaultStrategy = this.options.defaultStrategy || 'unified'
    if (this.strategies.has(defaultStrategy)) {
      this.currentStrategy = this.strategies.get(defaultStrategy)!
    } else {
      // 如果指定的默认策略不存在，回退到 unified
      this.currentStrategy = this.strategies.get('unified')!
    }

    this.logger.debug(
      {
        strategies: Array.from(this.strategies.keys()),
        defaultStrategy: this.currentStrategy?.name
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
        this.currentStrategy = this.strategies.get('unified')!
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
    
    // 启动进度跟踪
    this.progressTracker.start()

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
