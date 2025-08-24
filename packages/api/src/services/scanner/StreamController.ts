import { FastifyInstance } from 'fastify'
import {
  StreamControlOptions,
  PerformanceMetrics,
  MemoryUsage,
  ConcurrencyStats,
  BatchStats
} from '@pixishelf/shared'

/**
 * 流控制器
 * 负责控制处理流的速度、内存使用、批处理时机和并发调整
 */
export class StreamController {
  private options: StreamControlOptions
  private logger: FastifyInstance['log']
  private performanceHistory: number[] = []
  private memoryHistory: MemoryUsage[] = []
  private currentBatchSize: number = 0
  private lastFlushTime: number = Date.now()
  private currentConcurrency: number
  private maxConcurrency: number
  private isMemoryPressure: boolean = false
  private performanceTimer: NodeJS.Timeout | null = null

  constructor(
    logger: FastifyInstance['log'],
    options: Partial<StreamControlOptions> = {}
  ) {
    this.logger = logger
    this.options = {
      maxMemoryUsage: options.maxMemoryUsage || 1024 * 1024 * 1024, // 1GB
      batchFlushThreshold: options.batchFlushThreshold || 50,
      concurrencyAdjustmentFactor: options.concurrencyAdjustmentFactor || 0.1,
      memoryCheckInterval: options.memoryCheckInterval || 1000, // 1秒
      performanceSampleInterval: options.performanceSampleInterval || 5000 // 5秒
    }
    
    this.currentConcurrency = 4 // 默认并发数
    this.maxConcurrency = 8 // 最大并发数
    
    this.startPerformanceMonitoring()
  }

  /**
   * 检查是否应该处理下一个项目
   * @returns 是否可以继续处理
   */
  shouldProcessNext(): boolean {
    // 检查内存使用情况
    const memoryOk = this.checkMemoryUsage()
    
    // 检查并发限制
    const concurrencyOk = this.checkConcurrencyLimit()
    
    return memoryOk && concurrencyOk
  }

  /**
   * 等待内存可用
   * @returns Promise<void>
   */
  async waitForMemoryAvailable(): Promise<void> {
    while (!this.checkMemoryUsage()) {
      this.logger.debug('Memory pressure detected, waiting...')
      
      // 触发垃圾回收（如果可用）
      if (global.gc) {
        global.gc()
      }
      
      // 等待一段时间后重新检查
      await this.delay(this.options.memoryCheckInterval)
    }
    
    this.isMemoryPressure = false
  }

  /**
   * 检查是否应该刷新批处理
   * @returns 是否应该刷新
   */
  shouldFlushBatch(): boolean {
    const timeSinceLastFlush = Date.now() - this.lastFlushTime
    const sizeThreshold = this.currentBatchSize >= this.options.batchFlushThreshold
    const timeThreshold = timeSinceLastFlush > 5000 // 5秒强制刷新
    const memoryPressure = this.isMemoryPressure
    
    return sizeThreshold || timeThreshold || memoryPressure
  }

  /**
   * 更新批处理指标
   * @param batchSize 批处理大小
   */
  updateBatchMetrics(batchSize: number): void {
    this.currentBatchSize += batchSize
  }

  /**
   * 重置批处理指标
   */
  resetBatchMetrics(): void {
    this.currentBatchSize = 0
    this.lastFlushTime = Date.now()
  }

  /**
   * 调整并发数
   * @param currentLoad 当前负载指标
   * @returns 新的并发数
   */
  adjustConcurrency(currentLoad: number): number {
    // 记录性能历史
    this.performanceHistory.push(currentLoad)
    
    // 保持最近10个样本
    if (this.performanceHistory.length > 10) {
      this.performanceHistory.shift()
    }
    
    if (this.performanceHistory.length < 3) {
      return this.currentConcurrency
    }
    
    const avgLoad = this.performanceHistory.reduce((a, b) => a + b, 0) / this.performanceHistory.length
    
    // 根据平均负载调整并发数
    if (avgLoad > 1000 && this.currentConcurrency > 1) {
      // 负载过高，减少并发
      this.currentConcurrency = Math.max(1, this.currentConcurrency - 1)
      this.logger.debug({ newConcurrency: this.currentConcurrency }, 'Decreased concurrency due to high load')
    } else if (avgLoad < 500 && this.currentConcurrency < this.maxConcurrency && !this.isMemoryPressure) {
      // 负载较低且无内存压力，增加并发
      this.currentConcurrency = Math.min(this.maxConcurrency, this.currentConcurrency + 1)
      this.logger.debug({ newConcurrency: this.currentConcurrency }, 'Increased concurrency due to low load')
    }
    
    return this.currentConcurrency
  }

  /**
   * 获取最优并发数
   * @returns 最优并发数
   */
  getOptimalConcurrency(): number {
    return this.currentConcurrency
  }

  /**
   * 跟踪性能指标
   * @param metrics 性能指标
   */
  trackPerformance(metrics: Partial<PerformanceMetrics>): void {
    if (metrics.memoryUsage) {
      this.memoryHistory.push(metrics.memoryUsage)
      
      // 保持最近20个内存样本
      if (this.memoryHistory.length > 20) {
        this.memoryHistory.shift()
      }
    }
    
    // 检查内存趋势
    this.analyzeMemoryTrend()
  }

  /**
   * 获取控制器统计信息
   * @returns 控制器统计
   */
  getControllerStats(): {
    currentConcurrency: number
    maxConcurrency: number
    currentBatchSize: number
    isMemoryPressure: boolean
    memoryUsage: MemoryUsage
    performanceHistory: number[]
  } {
    return {
      currentConcurrency: this.currentConcurrency,
      maxConcurrency: this.maxConcurrency,
      currentBatchSize: this.currentBatchSize,
      isMemoryPressure: this.isMemoryPressure,
      memoryUsage: this.getCurrentMemoryUsage(),
      performanceHistory: [...this.performanceHistory]
    }
  }

  /**
   * 管理内存使用
   */
  manageMemoryUsage(): void {
    const currentUsage = this.getCurrentMemoryUsage()
    
    if (currentUsage.heapUsed > this.options.maxMemoryUsage * 0.8) {
      this.isMemoryPressure = true
      this.logger.warn({
        heapUsed: currentUsage.heapUsed,
        threshold: this.options.maxMemoryUsage * 0.8
      }, 'Memory pressure detected')
      
      // 触发垃圾回收
      if (global.gc) {
        global.gc()
      }
    } else if (currentUsage.heapUsed < this.options.maxMemoryUsage * 0.6) {
      this.isMemoryPressure = false
    }
  }

  /**
   * 停止控制器
   */
  stop(): void {
    if (this.performanceTimer) {
      clearInterval(this.performanceTimer)
      this.performanceTimer = null
    }
  }

  // ============================================================================
  // 私有方法
  // ============================================================================

  /**
   * 检查内存使用情况
   * @returns 内存是否可用
   */
  private checkMemoryUsage(): boolean {
    const usage = process.memoryUsage()
    const isOk = usage.heapUsed < this.options.maxMemoryUsage
    
    if (!isOk) {
      this.isMemoryPressure = true
    }
    
    return isOk
  }

  /**
   * 检查并发限制
   * @returns 是否在并发限制内
   */
  private checkConcurrencyLimit(): boolean {
    // 这里可以添加更复杂的并发检查逻辑
    // 目前简单返回true，实际的并发控制由ConcurrencyController处理
    return true
  }

  /**
   * 获取当前内存使用情况
   * @returns 内存使用情况
   */
  private getCurrentMemoryUsage(): MemoryUsage {
    const usage = process.memoryUsage()
    return {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss,
      peakUsage: Math.max(...this.memoryHistory.map(m => m.heapUsed), usage.heapUsed)
    }
  }

  /**
   * 分析内存趋势
   */
  private analyzeMemoryTrend(): void {
    if (this.memoryHistory.length < 5) {
      return
    }
    
    const recent = this.memoryHistory.slice(-5)
    const trend = recent[recent.length - 1].heapUsed - recent[0].heapUsed
    
    // 如果内存使用呈上升趋势且接近阈值，提前触发内存压力
    if (trend > 0 && recent[recent.length - 1].heapUsed > this.options.maxMemoryUsage * 0.7) {
      this.isMemoryPressure = true
      this.logger.debug('Memory trend indicates potential pressure')
    }
  }

  /**
   * 启动性能监控
   */
  private startPerformanceMonitoring(): void {
    this.performanceTimer = setInterval(() => {
      this.manageMemoryUsage()
    }, this.options.performanceSampleInterval)
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