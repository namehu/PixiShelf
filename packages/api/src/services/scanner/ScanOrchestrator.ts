import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import {
  ExtendedScanOptions,
  ExtendedScanResult,
  IScanOrchestrator,
  IScanStrategy,
  ScanStrategyType,
  ScanOrchestratorOptions
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
   * 初始化扫描策略
   */
  private initializeStrategies(): void {
    const strategyOptions = {
      maxConcurrency: this.options.maxConcurrency || 4,
      batchSize: 1000
    }

    const unifiedOptions = {
      maxConcurrency: this.options.maxConcurrency || 4,
      batchSize: strategyOptions.batchSize,
      streamBufferSize: 100,
      memoryThreshold: 1024 * 1024 * 1024 // 1GB
    }

    this.strategies.set('unified', new UnifiedScanStrategy(this.prisma, this.logger, unifiedOptions))

    // 设置默认策略
    const defaultStrategy = this.options.defaultStrategy || 'unified'
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
    this.currentStrategy = this.strategies.get(scanType || 'unified')!
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
}
