import { promises as fs } from 'fs'
import path from 'path'
import { PrismaClient, Prisma } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import { ConcurrencyController } from './scanner/ConcurrencyController'
import { BatchProcessor } from './scanner/BatchProcessor'
import { StreamingBatchProcessor } from './scanner/StreamingBatchProcessor'
import { CacheManager } from './scanner/CacheManager'
import { ProgressTracker } from './scanner/ProgressTracker'
import { PerformanceMonitor } from './scanner/PerformanceMonitor'
import { PerformanceMetrics, ScanTask, TaskResult } from './scanner/types'
import { FileSystemTimeReader } from '../utils/fsTimeReader'
import { config } from '../config'
import { ScanOrchestrator } from './scanner/ScanOrchestrator'
import { ExtendedScanOptions, ExtendedScanResult, ScanStrategyType, ScanOrchestratorOptions } from '@pixishelf/shared'

export interface ScanOptions {
  scanPath: string
  supportedExtensions?: string[]
  forceUpdate?: boolean
  onProgress?: (progress: ScanProgress) => void
}

export interface ScanProgress {
  phase: 'counting' | 'scanning' | 'creating' | 'cleanup' | 'complete'
  message: string
  current?: number
  total?: number
  percentage?: number
  estimatedSecondsRemaining?: number
}

export interface ScanResult {
  scannedDirectories: number
  foundImages: number
  newArtworks: number
  newImages: number
  removedArtworks: number
  errors: string[]
  // +++ 新增字段，用于告知前端哪些目录被跳过了 +++
  skippedDirectories: Array<{ path: string; reason: string }>
}

interface MetadataInfo {
  description?: string
  tags: string[]
}

export class FileScanner {
  private prisma: PrismaClient
  private logger: FastifyInstance['log']
  private supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff']
  private scanRootAbs: string | null = null

  // 性能优化组件
  private concurrencyController!: ConcurrencyController
  private batchProcessor!: BatchProcessor
  private streamingBatchProcessor!: StreamingBatchProcessor
  private cacheManager!: CacheManager
  private progressTracker!: ProgressTracker
  private performanceMonitor!: PerformanceMonitor
  private performanceMetrics!: PerformanceMetrics
  private fsTimeReader: FileSystemTimeReader
  private enableOptimizations: boolean = true
  private useStreamingBatch: boolean = true

  // 新增：扫描编排器
  private scanOrchestrator: ScanOrchestrator
  private enableMetadataScanning: boolean = false

  constructor(
    prisma: PrismaClient,
    logger: FastifyInstance['log'],
    options?: {
      enableStreaming?: boolean
      enableMetadataScanning?: boolean
      scanOrchestratorOptions?: ScanOrchestratorOptions
    }
  ) {
    this.prisma = prisma
    this.logger = logger
    this.useStreamingBatch = options?.enableStreaming ?? true
    this.enableOptimizations = config.scanner.enableOptimizations ?? true
    this.enableMetadataScanning = options?.enableMetadataScanning ?? false

    // 初始化性能优化组件
    this.concurrencyController = new ConcurrencyController(config.scanner.maxConcurrency)
    this.cacheManager = new CacheManager(this.supportedExtensions)
    this.batchProcessor = new BatchProcessor(this.prisma, this.logger, { batchSize: 500 }, (progress) => {
      this.logger.debug({ progress }, 'Batch processing progress')
    })
    this.streamingBatchProcessor = new StreamingBatchProcessor(this.prisma, this.logger)
    this.fsTimeReader = new FileSystemTimeReader()

    // 初始化扫描编排器
    this.scanOrchestrator = new ScanOrchestrator(this.prisma, this.logger, {
      enableOptimizations: this.enableOptimizations,
      maxConcurrency: config.scanner.maxConcurrency,
      defaultStrategy: 'unified',
      ...options?.scanOrchestratorOptions
    })

    this.initializePerformanceMetrics()
  }

  /**
   * 优化的扫描方法
   */
  private async scanOptimized(
    scanPath: string,
    extensions: string[],
    result: ScanResult,
    onProgress?: (progress: ScanProgress) => void
  ): Promise<void> {
    // 并发收集扫描任务
    this.progressTracker.setPhase('scanning')

    const scanTasks = await this.collectScanTasksConcurrently(scanPath, extensions, result)
    this.performanceMetrics.totalFiles = scanTasks.length

    this.progressTracker.updateScanningProgress(0, scanTasks.length)

    // 并发处理扫描任务
    let processedTasks = 0
    const startTime = Date.now()

    const taskBatches = this.createTaskBatches(scanTasks, 100) // 每批100个任务

    for (let batchIndex = 0; batchIndex < taskBatches.length; batchIndex++) {
      const batch = taskBatches[batchIndex]

      const batchResults = await this.concurrencyController.executeAllSettled(
        batch.map((task) => () => this.processScanTaskStreaming(task, extensions))
      )

      // 处理批次结果
      for (const taskResult of batchResults) {
        processedTasks++
        this.performanceMetrics.processedFiles++

        if (taskResult.status === 'fulfilled') {
          const { success, data, skipped, reason } = taskResult.value
          if (success && data) {
            this.addToResultStreaming(data, result)
          } else if (skipped && reason) {
            const reasonStr = reason instanceof Error ? reason.message : reason
            result.skippedDirectories.push({ path: data?.path || '', reason: reasonStr })
            this.performanceMetrics.skippedFiles++
          }
        } else {
          result.errors.push(taskResult.reason?.message || 'Unknown task error')
          this.performanceMetrics.errorFiles++
        }

        // 更新扫描进度
        if (processedTasks % 10 === 0 || processedTasks === scanTasks.length) {
          this.progressTracker.updateScanningProgress(processedTasks, scanTasks.length)
          this.performanceMonitor.updateProgress() // 通知性能监控器
        }
      }

      // 更新并发统计
      const concurrencyStatus = this.concurrencyController.getStatus()
      this.performanceMetrics.concurrencyStats.currentQueueLength = concurrencyStatus.queued
      this.performanceMetrics.concurrencyStats.peakQueueLength = Math.max(
        this.performanceMetrics.concurrencyStats.peakQueueLength,
        concurrencyStatus.queued
      )
    }

    // 最终化批量处理
    this.progressTracker.setPhase('finalizing')

    let finalBatchResult: any
    if (this.useStreamingBatch) {
      finalBatchResult = await this.streamingBatchProcessor.finalize()
    } else {
      finalBatchResult = await this.batchProcessor.flush()
    }

    this.updateResultFromBatch(finalBatchResult, result)
  }

  /**
   * 传统扫描方法（保持向后兼容）
   */
  private async scanLegacy(
    scanPath: string,
    extensions: string[],
    result: ScanResult,
    onProgress?: (progress: ScanProgress) => void
  ): Promise<void> {
    // 第一遍：扫描根目录下的艺术家文件夹
    onProgress?.({
      phase: 'counting',
      message: '预扫描：统计艺术家和作品目录...',
      percentage: 0
    })
    const { totalWorkUnits, artistCount, artworkCount } = await this.countArtistsAndArtworks(
      scanPath,
      extensions,
      onProgress
    )

    // 第二遍：正式扫描并按目录结构处理
    let processedWorkUnits = 0
    const scanStartTs = Date.now()
    const progressUpdate = (increment: number, message: string, phase: ScanProgress['phase'] = 'scanning') => {
      processedWorkUnits += increment
      const percentage =
        totalWorkUnits > 0 ? Math.min(99, Math.floor((processedWorkUnits / totalWorkUnits) * 100)) : undefined
      const elapsedSec = Math.max(0.001, (Date.now() - scanStartTs) / 1000)
      const rate = processedWorkUnits > 0 ? processedWorkUnits / elapsedSec : 0
      const remainingUnits = Math.max(0, totalWorkUnits - processedWorkUnits)
      const estSeconds = rate > 0 ? Math.ceil(remainingUnits / rate) : undefined
      const detailedMessage = `${message} [${processedWorkUnits}/${totalWorkUnits}] (${percentage || 0}%)`
      onProgress?.({
        phase,
        message: detailedMessage,
        current: processedWorkUnits,
        total: totalWorkUnits,
        percentage,
        estimatedSecondsRemaining: estSeconds
      })
    }

    const scanStartMessage = `开始扫描 ${artistCount} 个艺术家目录，${artworkCount} 个作品目录...`
    onProgress?.({
      phase: 'scanning',
      message: scanStartMessage,
      current: 0,
      total: totalWorkUnits,
      percentage: totalWorkUnits > 0 ? 0 : undefined
    })

    // 按照新的目录结构扫描
    await this.scanArtistDirectories(scanPath, extensions, result, progressUpdate)
  }

  /**
   * 最终处理阶段
   */
  private async finalizeScan(result: ScanResult, onProgress?: (progress: ScanProgress) => void): Promise<void> {
    onProgress?.({
      phase: 'cleanup',
      message: '清理无图片的作品...',
      percentage: 99
    })

    const removedCount = await this.cleanupEmptyArtworks()
    result.removedArtworks = removedCount
  }

  /**
   * 并发收集扫描任务
   */
  private async collectScanTasksConcurrently(
    rootPath: string,
    extensions: string[],
    result: ScanResult
  ): Promise<ScanTask[]> {
    const tasks: ScanTask[] = []

    try {
      const artistEntries = await fs.readdir(rootPath, { withFileTypes: true })

      // 处理艺术家目录，记录跳过的目录
      const validArtistEntries: typeof artistEntries = []

      for (const entry of artistEntries) {
        const artistPath = path.join(rootPath, entry.name)

        if (!entry.isDirectory()) continue

        if (this.cacheManager.isHiddenOrSystemFile(entry.name)) continue

        if (!this.isValidName(entry.name)) {
          const reason = '艺术家目录名包含不支持的字符'
          this.logger.warn(`${reason}: ${artistPath}`)
          result.skippedDirectories.push({ path: artistPath, reason })
          continue
        }

        validArtistEntries.push(entry)
      }

      // 并发处理有效的艺术家目录
      const artistTasks = validArtistEntries.map(
        (entry) => () => this.collectArtistTasks(rootPath, entry.name, extensions, result)
      )

      const artistTaskResults = await this.concurrencyController.executeAllSettled(artistTasks)

      for (const taskResult of artistTaskResults) {
        if (taskResult.status === 'fulfilled') {
          tasks.push(...taskResult.value)
        }
      }
    } catch (error) {
      this.logger.error({ error, rootPath }, 'Failed to collect scan tasks')
    }

    return tasks
  }

  /**
   * 收集单个艺术家的任务
   */
  private async collectArtistTasks(
    rootPath: string,
    artistName: string,
    extensions: string[],
    result: ScanResult
  ): Promise<ScanTask[]> {
    const tasks: ScanTask[] = []
    const artistPath = path.join(rootPath, artistName)

    // 添加艺术家任务
    tasks.push({
      type: 'artist',
      path: artistPath,
      metadata: { name: artistName }
    })

    try {
      const artworkEntries = await fs.readdir(artistPath, { withFileTypes: true })

      for (const artworkEntry of artworkEntries) {
        const artworkPath = path.join(artistPath, artworkEntry.name)

        if (!artworkEntry.isDirectory()) continue

        if (this.cacheManager.isHiddenOrSystemFile(artworkEntry.name)) continue

        if (!this.isValidName(artworkEntry.name)) {
          const reason = '作品目录名包含不支持的字符'
          this.logger.warn(`${reason}: ${artworkPath}`)
          result.skippedDirectories.push({ path: artworkPath, reason })
          continue
        }

        // 检查是否有图片文件
        const hasImages = await this.hasImageFiles(artworkPath, extensions)
        if (hasImages) {
          tasks.push({
            type: 'artwork',
            path: artworkPath,
            parentPath: artistPath,
            metadata: {
              title: artworkEntry.name,
              artistName: artistName
            }
          })
        }
      }
    } catch (error) {
      this.logger.warn({ error, artistPath }, 'Failed to collect artwork tasks')
    }

    return tasks
  }

  /**
   * 处理单个扫描任务
   */
  private async processScanTask(task: ScanTask, extensions: string[]): Promise<TaskResult> {
    try {
      switch (task.type) {
        case 'artist':
          return await this.processArtistTask(task)
        case 'artwork':
          return await this.processArtworkTask(task, extensions)
        default:
          return {
            success: false,
            error: `Unknown task type: ${task.type}`
          }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: { path: task.path }
      }
    }
  }

  /**
   * 处理单个扫描任务（流式版本）
   */
  private async processScanTaskStreaming(task: ScanTask, extensions: string[]): Promise<TaskResult> {
    try {
      switch (task.type) {
        case 'artist':
          return await this.processArtistTaskStreaming(task)
        case 'artwork':
          return await this.processArtworkTaskStreaming(task, extensions)
        default:
          return {
            success: false,
            error: `Unknown task type: ${task.type}`
          }
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        data: { path: task.path }
      }
    }
  }

  /**
   * 处理艺术家任务
   */
  private async processArtistTask(task: ScanTask): Promise<TaskResult> {
    const artistData = this.cacheManager.parseArtistName(task.metadata.name)

    this.batchProcessor.addArtist({
      name: artistData.displayName,
      username: artistData.username,
      userId: artistData.userId,
      bio:
        artistData.username && artistData.userId
          ? `Artist: ${artistData.username} (ID: ${artistData.userId})`
          : `Artist discovered from directory: ${task.metadata.name}`
    })

    return {
      success: true,
      data: { type: 'artist', name: artistData.displayName }
    }
  }

  /**
   * 处理艺术家任务（流式版本）
   */
  private async processArtistTaskStreaming(task: ScanTask): Promise<TaskResult> {
    const artistData = this.cacheManager.parseArtistName(task.metadata.name)

    this.streamingBatchProcessor.addArtist({
      name: artistData.displayName,
      username: artistData.username,
      userId: artistData.userId,
      bio:
        artistData.username && artistData.userId
          ? `Artist: ${artistData.username} (ID: ${artistData.userId})`
          : `Artist discovered from directory: ${task.metadata.name}`
    })

    return {
      success: true,
      data: { type: 'artist', name: artistData.displayName }
    }
  }

  /**
   * 处理作品任务
   */
  private async processArtworkTask(task: ScanTask, extensions: string[]): Promise<TaskResult> {
    const { title, artistName } = task.metadata

    // 收集图片
    const images = await this.collectImagesFromDirectory(task.path, extensions)
    if (images.length === 0) {
      return {
        success: false,
        skipped: true,
        reason: '没有找到图片文件',
        data: { path: task.path }
      }
    }

    // 解析元数据
    const metadata = await this.parseMetadata(task.path)

    // 获取目录创建时间和计算新字段
    const directoryCreatedAt = await this.fsTimeReader.getDirectoryCreatedTime(task.path)
    const imageCount = images.length
    const descriptionLength = metadata.description?.length || 0

    // 添加到批量处理器
    this.batchProcessor.addArtwork({
      title,
      description: metadata.description,
      artistId: 0, // 将在批量处理时解析
      artistName,
      directoryCreatedAt,
      imageCount,
      descriptionLength
    })

    // 添加图片（按排序顺序）
    for (let i = 0; i < images.length; i++) {
      const imagePath = images[i]
      const stats = await fs.stat(imagePath)
      const relativePath = this.cacheManager.getRelativePath(imagePath, this.scanRootAbs!)

      this.batchProcessor.addImage({
        path: relativePath,
        size: stats.size,
        sortOrder: i,
        artworkTitle: title,
        artistName
      })
    }

    // 添加标签
    for (const tagName of metadata.tags) {
      const cleanedTag = this.cacheManager.cleanTagPrefix(tagName)
      if (cleanedTag) {
        this.batchProcessor.addTag({ name: cleanedTag })
        this.batchProcessor.addArtworkTag(title, artistName, cleanedTag)
      }
    }

    return {
      success: true,
      data: {
        type: 'artwork',
        title,
        artistName,
        imageCount: images.length,
        tagCount: metadata.tags.length
      }
    }
  }

  /**
   * 处理作品任务（流式版本）
   */
  private async processArtworkTaskStreaming(task: ScanTask, extensions: string[]): Promise<TaskResult> {
    const { title, artistName } = task.metadata

    // 收集图片
    const images = await this.collectImagesFromDirectory(task.path, extensions)
    if (images.length === 0) {
      return {
        success: false,
        skipped: true,
        reason: '没有找到图片文件',
        data: { path: task.path }
      }
    }

    // 解析元数据
    const metadata = await this.parseMetadata(task.path)

    // 获取目录创建时间和计算新字段
    const directoryCreatedAt = await this.fsTimeReader.getDirectoryCreatedTime(task.path)
    const imageCount = images.length
    const descriptionLength = metadata.description?.length || 0

    // 添加到流式批量处理器
    this.streamingBatchProcessor.addArtwork({
      title,
      description: metadata.description,
      artistId: 0, // 将在批量处理时解析
      artistName,
      directoryCreatedAt,
      imageCount,
      descriptionLength
    })

    // 添加图片（按排序顺序）
    for (let i = 0; i < images.length; i++) {
      const imagePath = images[i]
      const stats = await fs.stat(imagePath)
      const relativePath = this.cacheManager.getRelativePath(imagePath, this.scanRootAbs!)

      this.streamingBatchProcessor.addImage({
        path: relativePath,
        size: stats.size,
        sortOrder: i,
        artworkTitle: title,
        artistName
      })
    }

    // 添加标签
    for (const tagName of metadata.tags) {
      const cleanedTag = this.cacheManager.cleanTagPrefix(tagName)
      if (cleanedTag) {
        this.streamingBatchProcessor.addTag({ name: cleanedTag })
        this.streamingBatchProcessor.addArtworkTag(title, artistName, cleanedTag)
      }
    }

    return {
      success: true,
      data: {
        type: 'artwork',
        title,
        artistName,
        imageCount: images.length,
        tagCount: metadata.tags.length
      }
    }
  }

  /**
   * 创建任务批次
   */
  private createTaskBatches<T>(tasks: T[], batchSize: number): T[][] {
    const batches: T[][] = []
    for (let i = 0; i < tasks.length; i += batchSize) {
      batches.push(tasks.slice(i, i + batchSize))
    }
    return batches
  }

  /**
   * 将任务结果添加到扫描结果
   */
  private addToResult(data: any, result: ScanResult): void {
    if (data.type === 'artwork') {
      result.scannedDirectories++
      result.foundImages += data.imageCount || 0
    }
  }

  /**
   * 将任务结果添加到扫描结果（流式版本）
   */
  private addToResultStreaming(data: any, result: ScanResult): void {
    if (data.type === 'artwork') {
      result.scannedDirectories++
      result.foundImages += data.imageCount || 0
    }
  }

  /**
   * 从批量处理结果更新扫描结果
   */
  private updateResultFromBatch(batchResult: any, result: ScanResult): void {
    result.newArtworks += batchResult.artworksCreated || 0
    result.newImages += batchResult.imagesCreated || 0
    result.errors.push(...(batchResult.errors || []).map((e: any) => e.error))

    // 更新数据库统计
    this.performanceMetrics.databaseStats.totalInserts +=
      (batchResult.artistsCreated || 0) +
      (batchResult.artworksCreated || 0) +
      (batchResult.imagesCreated || 0) +
      (batchResult.tagsCreated || 0)
  }

  /**
   * 更新内存使用统计
   */
  private updateMemoryUsage(): void {
    const memUsage = process.memoryUsage()
    this.performanceMetrics.memoryUsage = {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss
    }
  }

  /**
   * 计算吞吐量
   */
  private calculateThroughput(): number {
    if (!this.performanceMetrics.endTime || !this.performanceMetrics.startTime) {
      return 0
    }

    const elapsedSeconds = (this.performanceMetrics.endTime - this.performanceMetrics.startTime) / 1000
    return elapsedSeconds > 0 ? this.performanceMetrics.processedFiles / elapsedSeconds : 0
  }

  /**
   * 获取性能报告
   */
  private getPerformanceReport(): any {
    const cacheStats = this.cacheManager.getStats()
    const concurrencyStatus = this.concurrencyController.getStatus()

    return {
      ...this.performanceMetrics,
      cacheStats,
      concurrencyStatus,
      optimizationsEnabled: this.enableOptimizations
    }
  }

  /**
   * 获取性能指标（公共方法）
   */
  getPerformanceMetrics(): PerformanceMetrics {
    return { ...this.performanceMetrics }
  }

  /**
   * 获取缓存统计（公共方法）
   */
  getCacheStats() {
    return this.cacheManager.getStats()
  }

  /**
   * 获取并发状态（公共方法）
   */
  getConcurrencyStatus() {
    return this.concurrencyController.getStatus()
  }

  /**
   * 初始化性能指标
   */
  private initializePerformanceMetrics(): void {
    this.performanceMetrics = {
      startTime: 0,
      totalFiles: 0,
      processedFiles: 0,
      skippedFiles: 0,
      errorFiles: 0,
      throughput: 0,
      memoryUsage: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0
      },
      concurrencyStats: {
        maxConcurrent: 0,
        avgConcurrent: 0,
        peakQueueLength: 0,
        currentQueueLength: 0
      },
      databaseStats: {
        totalQueries: 0,
        batchOperations: 0,
        avgBatchSize: 0,
        totalInserts: 0,
        totalUpdates: 0
      }
    }
  }

  /**
   * 检查文件名/目录名是否只包含安全的字符（优化版本）
   * @param name 要检查的名称
   * @returns 如果名称安全则返回 true，否则返回 false
   */
  private isValidName(name: string): boolean {
    if (this.enableOptimizations) {
      return this.cacheManager.isValidName(name)
    }

    // 回退到原始实现
    const safeNameRegex = /^[a-zA-Z0-9\s_\-.()\u4e00-\u9fa5\u3040-\u30ff]+$/
    return safeNameRegex.test(name)
  }

  /**
   * 新的扫描方法，支持元数据扫描
   * @param options 扩展的扫描选项
   * @returns 扫描结果
   */
  async scanWithMetadata(options: ExtendedScanOptions): Promise<ExtendedScanResult> {
    if (!this.enableMetadataScanning) {
      throw new Error('Metadata scanning is not enabled. Please enable it in constructor options.')
    }

    try {
      this.logger.info(
        {
          scanPath: options.scanPath,
          scanType: options.scanType,
          enableMetadataScanning: this.enableMetadataScanning
        },
        'Starting metadata-enabled scan'
      )

      return await this.scanOrchestrator.scan(options)
    } catch (error) {
      this.logger.error({ error, options }, 'Metadata scan failed')
      throw error
    }
  }

  /**
   * 获取推荐的扫描策略
   * @param options 扫描选项
   * @returns 推荐策略信息
   */
  async getRecommendedStrategy(options: ExtendedScanOptions): Promise<{
    recommended: ScanStrategyType
    reason: string
    alternatives: Array<{ strategy: ScanStrategyType; reason: string }>
  }> {
    return await this.scanOrchestrator.recommendStrategy(options)
  }

  /**
   * 检查策略可用性
   * @param options 扫描选项
   * @returns 策略可用性信息
   */
  async checkStrategyAvailability(options: ExtendedScanOptions): Promise<{
    [K in ScanStrategyType]: {
      available: boolean
      issues: string[]
      estimatedDuration: number
    }
  }> {
    return await this.scanOrchestrator.checkStrategyAvailability(options)
  }

  /**
   * 设置扫描策略
   * @param strategy 策略类型
   */
  setStrategy(strategy: ScanStrategyType): void {
    this.scanOrchestrator.setStrategy(strategy)
  }

  /**
   * 获取当前策略信息
   * @returns 当前策略信息
   */
  getCurrentStrategy(): { name: string; description: string } | null {
    return this.scanOrchestrator.getCurrentStrategy()
  }

  /**
   * 获取支持的扫描策略
   * @returns 策略列表
   */
  getSupportedStrategies(): string[] {
    return this.scanOrchestrator.getSupportedStrategies()
  }

  /**
   * 传统扫描方法（保持向后兼容）
   * @param options 扫描选项
   * @returns 扫描结果
   */
  async scan(options: ScanOptions): Promise<ScanResult> {
    // 初始化性能监控
    this.performanceMetrics.startTime = Date.now()
    this.updateMemoryUsage()

    const result: ScanResult = {
      scannedDirectories: 0,
      foundImages: 0,
      newArtworks: 0,
      newImages: 0,
      removedArtworks: 0,
      errors: [],
      skippedDirectories: []
    }

    try {
      const scanPath = options.scanPath
      const extensions = options.supportedExtensions || this.supportedExtensions
      const forceUpdate = options.forceUpdate || false
      const onProgress = options.onProgress

      // 记录规范化后的扫描根目录
      this.scanRootAbs = path.resolve(scanPath)

      // 初始化进度跟踪器
      this.progressTracker = new ProgressTracker(this.logger, onProgress, (detailedProgress) => {
        this.logger.debug({ detailedProgress }, 'Detailed progress update')
      })

      // 启动进度跟踪
      this.progressTracker.start()

      // 初始化流式批量处理器（如果启用）
      if (this.useStreamingBatch) {
        this.streamingBatchProcessor = new StreamingBatchProcessor(
          this.prisma,
          this.logger,
          {
            microBatchSize: 50,
            maxConcurrentFlushes: 3,
            flushInterval: 2000,
            progressUpdateInterval: 1000
          },
          (detailedProgress) => {
            this.progressTracker.updateBatchingProgress(detailedProgress.batching)
          }
        )
      }

      // 初始化性能监控器
      this.performanceMonitor = new PerformanceMonitor(this.logger, {
        monitoringInterval: 2000,
        enableRealTimeAlerts: true,
        enableMetricsCollection: true,
        alertThresholds: {
          blockingDuration: 5000,
          memoryUsage: 85,
          databaseFailureRate: 5,
          averageQueryTime: 3000,
          connectionPoolUsage: 80,
          queueLength: 1000,
          throughputDrop: 50
        }
      })

      // 注册组件到性能监控器
      this.performanceMonitor.registerComponents({
        concurrencyController: this.concurrencyController,
        progressTracker: this.progressTracker,
        streamingBatchProcessor: this.useStreamingBatch ? this.streamingBatchProcessor : undefined,
        dbOptimizer: this.useStreamingBatch ? this.streamingBatchProcessor['dbOptimizer'] : undefined
      })

      // 启动性能监控
      this.performanceMonitor.startMonitoring()

      // 监听性能事件
      this.performanceMonitor.on('alert', (alert) => {
        this.logger.warn({ alert }, `Performance alert: ${alert.message}`)
      })

      this.performanceMonitor.on('blockingDetected', (data) => {
        this.logger.error({ data }, 'Blocking detected in scan process')
      })

      this.logger.info(
        {
          scanPath,
          forceUpdate,
          enableOptimizations: this.enableOptimizations,
          useStreamingBatch: this.useStreamingBatch,
          maxConcurrency: this.concurrencyController.getStatus().maxConcurrency
        },
        `Starting optimized scan of: ${scanPath}`
      )

      this.progressTracker.setPhase('scanning')

      // 检查扫描路径是否存在
      try {
        await fs.access(scanPath)
      } catch (error) {
        throw new Error(`Scan path does not exist: ${scanPath}`)
      }

      // 如果强制更新，先清理所有相关数据
      if (forceUpdate) {
        await this.cleanupExistingData((progress) => {
          onProgress?.(progress)
        })
      }

      // 选择扫描策略
      if (this.enableOptimizations) {
        await this.scanOptimized(scanPath, extensions, result, onProgress)
      } else {
        await this.scanLegacy(scanPath, extensions, result, onProgress)
      }

      // 最终处理
      await this.finalizeScan(result, onProgress)

      // 更新性能指标
      this.performanceMetrics.endTime = Date.now()
      this.performanceMetrics.throughput = this.calculateThroughput()

      const completeMessage = `扫描完成！处理了 ${result.scannedDirectories} 个目录，创建了 ${result.newArtworks} 个作品，${result.newImages} 张图片。跳过了 ${result.skippedDirectories.length} 个命名不规范的目录。`
      onProgress?.({
        phase: 'complete',
        message: completeMessage,
        percentage: 100
      })

      this.logger.info(
        {
          result,
          performanceMetrics: this.getPerformanceReport()
        },
        'Scan completed'
      )

      return result
    } catch (error) {
      this.performanceMetrics.errorFiles++
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      result.errors.push(errorMsg)
      this.logger.error({ error, performanceMetrics: this.performanceMetrics }, 'Scan failed')
      return result
    } finally {
      // 清理资源
      if (this.progressTracker) {
        this.progressTracker.stop()
      }
      if (this.performanceMonitor) {
        this.performanceMonitor.stopMonitoring()

        // 记录最终性能报告
        const performanceReport = this.performanceMonitor.getPerformanceReport()
        this.logger.info({ performanceReport }, 'Final performance report')
      }
    }
  }

  // 新的预扫描统计：按照 Artist/Artwork 层级结构统计
  private async countArtistsAndArtworks(
    rootPath: string,
    extensions: string[],
    onProgress?: (progress: ScanProgress) => void
  ): Promise<{
    totalWorkUnits: number
    artistCount: number
    artworkCount: number
  }> {
    let artistCount = 0
    let artworkCount = 0
    let scannedDirs = 0
    const startTime = Date.now()

    onProgress?.({
      phase: 'counting',
      message: '开始快速预扫描目录结构...',
      percentage: 0
    })

    try {
      const artistEntries = await fs.readdir(rootPath, { withFileTypes: true })
      const validArtistEntries = artistEntries.filter(
        (entry) =>
          this.isValidName(entry.name) &&
          !entry.name.startsWith('.') &&
          !entry.name.startsWith('$') &&
          entry.isDirectory()
      )

      onProgress?.({
        phase: 'counting',
        message: `发现 ${validArtistEntries.length} 个艺术家目录，开始统计作品...`,
        percentage: 10
      })

      // 使用并发处理来加速预扫描
      const concurrencyLimit = 10 // 限制并发数避免文件系统过载
      const batches = this.createTaskBatches(validArtistEntries, concurrencyLimit)

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex]

        // 并发处理当前批次
        const batchPromises = batch.map(async (artistEntry) => {
          const artistPath = path.join(rootPath, artistEntry.name)
          let localArtworkCount = 0

          try {
            const artworkEntries = await fs.readdir(artistPath, { withFileTypes: true })

            // 快速统计：只检查目录数量，不深入检查图片文件
            for (const artworkEntry of artworkEntries) {
              if (
                this.isValidName(artworkEntry.name) &&
                !artworkEntry.name.startsWith('.') &&
                !artworkEntry.name.startsWith('$') &&
                artworkEntry.isDirectory()
              ) {
                localArtworkCount++
              }
            }
          } catch (error) {
            this.logger.warn({ error, artistPath }, 'Failed to scan artist directory during counting')
          }

          return { artistName: artistEntry.name, artworkCount: localArtworkCount }
        })

        const batchResults = await Promise.all(batchPromises)

        // 累计结果
        for (const result of batchResults) {
          artistCount++
          artworkCount += result.artworkCount
          scannedDirs++
        }

        // 更新进度
        const progress = 10 + ((batchIndex + 1) / batches.length) * 80
        const elapsed = Date.now() - startTime
        const estimated = (elapsed / (batchIndex + 1)) * (batches.length - batchIndex - 1)

        onProgress?.({
          phase: 'counting',
          message: `预扫描进度: ${scannedDirs}/${validArtistEntries.length} 艺术家目录，发现 ${artworkCount} 个作品目录`,
          percentage: Math.round(progress),
          estimatedSecondsRemaining: Math.round(estimated / 1000)
        })
      }
    } catch (error) {
      this.logger.warn({ error, rootPath }, 'Failed to scan root directory during counting')
    }

    const totalWorkUnits = artistCount + artworkCount
    const elapsed = Date.now() - startTime
    const summaryMessage = `预扫描完成！发现 ${artistCount} 个艺术家，${artworkCount} 个作品目录，耗时 ${Math.round(elapsed / 1000)}秒`

    onProgress?.({
      phase: 'counting',
      message: summaryMessage,
      current: totalWorkUnits,
      total: totalWorkUnits,
      percentage: 100
    })

    this.logger.info({ artistCount, artworkCount, totalWorkUnits, elapsed }, 'Directory counting completed')
    return { totalWorkUnits, artistCount, artworkCount }
  }

  // 检查目录是否包含图片文件
  private async hasImageFiles(dirPath: string, extensions: string[]): Promise<boolean> {
    try {
      // 规范化路径，处理可能的空格和特殊字符
      const normalizedPath = path.normalize(dirPath)
      const entries = await fs.readdir(normalizedPath, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isFile() && extensions.includes(path.extname(entry.name).toLowerCase())) {
          return true
        }
      }
      return false
    } catch (error) {
      this.logger.warn(
        // @ts-ignore
        { error: error.message, dirPath },
        `Failed to read directory: ${dirPath}`
      )
      return false
    }
  }

  // 按照新的目录结构扫描：根目录下每个文件夹作为 Artist，Artist 下的子文件夹作为 Artwork
  private async scanArtistDirectories(
    rootPath: string,
    extensions: string[],
    result: ScanResult,
    progressUpdate: (increment: number, message: string, phase?: ScanProgress['phase']) => void
  ): Promise<void> {
    try {
      const artistEntries = await fs.readdir(rootPath, { withFileTypes: true })

      for (const artistEntry of artistEntries) {
        const artistPath = path.join(rootPath, artistEntry.name)

        // +++ 改动点：在这里加入名称验证和记录 +++
        if (!this.isValidName(artistEntry.name)) {
          const reason = '艺术家目录名包含不支持的字符'
          this.logger.warn(`${reason}: ${artistPath}`)
          result.skippedDirectories.push({ path: artistPath, reason })
          progressUpdate(1, `跳过目录: ${artistEntry.name}`)
          continue
        }

        // 跳过隐藏目录和文件
        if (artistEntry.name.startsWith('.') || artistEntry.name.startsWith('$') || !artistEntry.isDirectory()) {
          continue
        }

        result.scannedDirectories++

        progressUpdate(1, `处理艺术家目录: ${artistEntry.name}`)

        // 创建或获取艺术家
        const artist = await this.findOrCreateArtist(artistEntry.name)

        if (!artist) {
          result.errors.push(`Failed to create artist: ${artistEntry.name}`)
          continue
        }

        // 扫描艺术家目录下的作品
        await this.scanArtworkDirectories(artistPath, artist.id, extensions, result, progressUpdate)
      }
    } catch (error) {
      const errorMsg = `Failed to scan artist directories: ${error instanceof Error ? error.message : 'Unknown error'}`
      result.errors.push(errorMsg)
      this.logger.error({ error, rootPath }, 'Artist directories scan failed')
    }
  }

  // 扫描艺术家目录下的作品文件夹
  private async scanArtworkDirectories(
    artistPath: string,
    artistId: number,
    extensions: string[],
    result: ScanResult,
    progressUpdate: (increment: number, message: string, phase?: ScanProgress['phase']) => void
  ): Promise<void> {
    try {
      const artworkEntries = await fs.readdir(artistPath, {
        withFileTypes: true
      })

      for (const artworkEntry of artworkEntries) {
        const artworkPath = path.join(artistPath, artworkEntry.name)

        // +++ 改动点：在这里加入名称验证和记录 +++
        if (!this.isValidName(artworkEntry.name)) {
          const reason = '作品目录名包含不支持的字符'
          this.logger.warn(`${reason}: ${artworkPath}`)
          result.skippedDirectories.push({ path: artworkPath, reason })
          progressUpdate(1, `跳过目录: ${artworkEntry.name}`)
          continue
        }

        // 跳过隐藏目录和文件
        if (artworkEntry.name.startsWith('.') || artworkEntry.name.startsWith('$') || !artworkEntry.isDirectory()) {
          continue
        }

        // 收集该作品目录下的图片
        const images = await this.collectImagesFromDirectory(artworkPath, extensions)

        if (images.length === 0) {
          continue // 跳过没有图片的目录
        }

        result.foundImages += images.length
        progressUpdate(1, `处理作品目录: ${artworkEntry.name} (${images.length}张图片)`, 'creating')

        // 解析元数据
        const metadata = await this.parseMetadata(artworkPath)

        // 创建作品记录
        await this.createArtworkFromDirectoryV2(artworkPath, artworkEntry.name, artistId, images, metadata, result)
      }
    } catch (error) {
      const errorMsg = `Failed to scan artwork directories in ${artistPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      result.errors.push(errorMsg)
      this.logger.error({ error, artistPath }, 'Artwork directories scan failed')
    }
  }

  // 解析元数据文件 (*_metadata.txt)
  private async parseMetadata(artworkPath: string): Promise<MetadataInfo> {
    const metadata: MetadataInfo = {
      description: undefined,
      tags: []
    }

    const normalizeSection = (line: string) => line.trim().replace(/:$/, '')

    try {
      const entries = await fs.readdir(artworkPath)
      const metadataFile = entries.find((entry) => {
        const lower = entry.toLowerCase()
        // 兼容 *_metadata.txt、*-metadata.txt 与 metadata.txt
        if (/(-|_)?meta\.txt$/.test(lower)) return true

        return lower.endsWith('_metadata.txt') || lower.endsWith('-metadata.txt') || lower === 'metadata.txt'
      })

      if (!metadataFile) {
        return metadata
      }

      const metadataPath = path.join(artworkPath, metadataFile)
      const content = await fs.readFile(metadataPath, 'utf-8')

      // 解析元数据文件内容（兼容 CRLF）
      const lines = content.split(/\r?\n/).map((line) => line.trim())
      let i = 0

      while (i < lines.length) {
        const raw = lines[i]
        const section = normalizeSection(raw)

        // 处理 Description 段，可能为空或多行
        if (section === 'Description') {
          i += 1
          const descLines: string[] = []

          // 收集描述内容直到遇到下一个段落标题或文件结束
          while (i < lines.length) {
            const peek = lines[i]
            const peekNorm = normalizeSection(peek)

            // 如果遇到已知的段落标题，停止收集描述
            if (this.isMetadataSection(peek)) {
              break
            }

            // 即使是空行也收集（保持原始格式）
            descLines.push(peek)
            i += 1
          }

          const desc = descLines.join('\n').trim()
          if (desc) {
            metadata.description = desc
          }
          // 不要 continue，让外层循环处理当前的段落标题
          continue
        }

        // 处理 Tags 段
        if (section === 'Tags') {
          i += 1
          while (i < lines.length) {
            const tagLineRaw = lines[i]

            // 如果遇到下一个段落标题，停止处理标签
            if (this.isMetadataSection(tagLineRaw)) {
              break
            }

            // 只有非空行才处理
            if (tagLineRaw.trim()) {
              // 支持以 # 或 - 开头的标记
              let t = tagLineRaw.trim()
              if (t.startsWith('#')) t = t.slice(1)
              else if (t.startsWith('- ')) t = t.slice(2)
              t = t.trim()
              if (t) metadata.tags.push(t)
            }
            i += 1
          }
          // Tags 处理完毕，不需要继续
          break
        }

        i += 1
      }

      this.logger.debug(
        `Parsed metadata for ${artworkPath}: ${metadata.tags.length} tags, description: ${!!metadata.description}`
      )
    } catch (error) {
      this.logger.warn({ error, artworkPath }, 'Failed to parse metadata file')
    }

    return metadata
  }

  // 检查是否是元数据文件的段落标题（大小写不敏感，兼容冒号）
  private isMetadataSection(line: string): boolean {
    const sections = [
      'ID',
      'URL',
      'Original',
      'Thumbnail',
      'xRestrict',
      'AI',
      'User',
      'UserID',
      'Title',
      'Description',
      'Tags',
      'Size',
      'Bookmark',
      'Date'
    ]
    const normalized = line.trim().replace(/:$/, '')
    const lower = normalized.toLowerCase()
    return sections.some((s) => s.toLowerCase() === lower)
  }

  // 收集目录下的所有图片文件
  private async collectImagesFromDirectory(dirPath: string, extensions: string[]): Promise<string[]> {
    const images: string[] = []

    try {
      // 规范化路径，处理可能的空格和特殊字符
      const normalizedPath = path.normalize(dirPath)
      const entries = await fs.readdir(normalizedPath, { withFileTypes: true })

      for (const entry of entries) {
        if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase()
          if (extensions.includes(ext)) {
            images.push(path.join(dirPath, entry.name))
          }
        }
      }

      // 使用自然排序算法对图片文件进行排序
      images.sort(this.naturalSort)
    } catch (error) {
      this.logger.warn({ error, dirPath }, 'Failed to collect images from directory')
    }

    return images
  }

  /**
   * 自然排序算法，正确处理文件名中的数字
   * 例如：p1.jpg, p2.jpg, p10.jpg 而不是 p1.jpg, p10.jpg, p2.jpg
   */
  private naturalSort(a: string, b: string): number {
    const aName = path.basename(a)
    const bName = path.basename(b)

    // 将字符串分割为数字和非数字部分
    const aParts = aName.split(/([0-9]+)/)
    const bParts = bName.split(/([0-9]+)/)

    const maxLength = Math.max(aParts.length, bParts.length)

    for (let i = 0; i < maxLength; i++) {
      const aPart = aParts[i] || ''
      const bPart = bParts[i] || ''

      // 如果两个部分都是数字，按数值比较
      if (/^[0-9]+$/.test(aPart) && /^[0-9]+$/.test(bPart)) {
        const aNum = parseInt(aPart, 10)
        const bNum = parseInt(bPart, 10)
        if (aNum !== bNum) {
          return aNum - bNum
        }
      } else {
        // 否则按字符串比较
        if (aPart !== bPart) {
          return aPart.localeCompare(bPart)
        }
      }
    }

    return 0
  }

  // 创建作品记录（V2.2 版本 - 使用多对多标签关系）
  private async createArtworkFromDirectoryV2(
    artworkPath: string,
    artworkTitle: string,
    artistId: number,
    imagePaths: string[],
    metadata: MetadataInfo,
    result: ScanResult
  ): Promise<void> {
    try {
      // 获取目录创建时间
      const directoryCreatedAt = await this.fsTimeReader.getDirectoryCreatedTime(artworkPath)

      // 计算新字段值
      const imageCount = imagePaths.length
      const descriptionLength = metadata.description?.length || 0

      // 检查是否已存在相同的作品（基于 artistId + title 的唯一约束）
      let artwork
      try {
        artwork = await this.prisma.artwork.create({
          data: {
            title: artworkTitle,
            description: metadata.description || null,
            artistId: artistId,
            directoryCreatedAt: directoryCreatedAt,
            imageCount: imageCount,
            descriptionLength: descriptionLength
          }
        })
        result.newArtworks++
        this.logger.info(
          `Created new artwork: ${artworkTitle} (${imageCount} images, dir created: ${directoryCreatedAt.toISOString()})`
        )
      } catch (e) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          // 命中唯一约束 (artistId, title) 冲突，查找既有记录并更新元数据
          artwork = await this.prisma.artwork.findFirst({
            where: { title: artworkTitle, artistId: artistId }
          })

          if (artwork) {
            // 更新已存在的作品的所有字段
            artwork = await this.prisma.artwork.update({
              where: { id: artwork.id },
              data: {
                description: metadata.description || artwork.description,
                directoryCreatedAt: directoryCreatedAt,
                imageCount: imageCount,
                descriptionLength: descriptionLength
              }
            })
            this.logger.info(
              `Updated existing artwork: ${artworkTitle} (${imageCount} images, dir created: ${directoryCreatedAt.toISOString()})`
            )
          } else {
            throw e
          }
        } else {
          throw e
        }
      }

      // 处理标签（多对多关系）
      if (metadata.tags.length > 0) {
        await this.updateArtworkTags(artwork.id, metadata.tags)
      }

      // 处理图片（按排序顺序）
      for (let i = 0; i < imagePaths.length; i++) {
        await this.createImageRecord(imagePaths[i], artwork.id, i, result)
      }
    } catch (error) {
      const errorMsg = `Failed to create artwork for ${artworkPath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      result.errors.push(errorMsg)
      this.logger.error({ error, artworkPath }, 'Artwork creation failed')
    }
  }

  // 更新作品标签（多对多关系）
  private async updateArtworkTags(artworkId: number, tagNames: string[]): Promise<void> {
    try {
      // 首先删除该作品的所有现有标签关联
      await this.prisma.artworkTag.deleteMany({
        where: { artworkId }
      })

      // 为每个标签创建或查找记录，然后建立关联
      for (const tagName of tagNames) {
        if (!tagName.trim()) continue

        // 查找或创建标签
        const tag = await this.prisma.tag.upsert({
          where: { name: tagName.trim() },
          update: {},
          create: { name: tagName.trim() }
        })

        // 创建作品-标签关联
        await this.prisma.artworkTag.create({
          data: {
            artworkId,
            tagId: tag.id
          }
        })
      }

      this.logger.debug(`Updated tags for artwork ${artworkId}: ${tagNames.length} tags`)
    } catch (error) {
      this.logger.error({ error, artworkId, tagNames }, 'Failed to update artwork tags')
    }
  }

  private async cleanupExistingData(onProgress?: (progress: ScanProgress) => void): Promise<void> {
    try {
      onProgress?.({
        phase: 'cleanup',
        message: '正在清理现有数据...',
        percentage: 0
      })

      // 分步删除，提供进度反馈
      this.logger.info('Starting cleanup: deleting images...')
      onProgress?.({
        phase: 'cleanup',
        message: '正在删除图片数据...',
        percentage: 10
      })
      await this.prisma.image.deleteMany({})

      this.logger.info('Cleanup: deleting artwork tags...')
      onProgress?.({
        phase: 'cleanup',
        message: '正在删除作品标签关联...',
        percentage: 30
      })
      await this.prisma.artworkTag.deleteMany({})

      this.logger.info('Cleanup: deleting artworks...')
      onProgress?.({
        phase: 'cleanup',
        message: '正在删除作品数据...',
        percentage: 60
      })
      await this.prisma.artwork.deleteMany({})

      this.logger.info('Cleanup: deleting artists...')
      onProgress?.({
        phase: 'cleanup',
        message: '正在删除艺术家数据...',
        percentage: 80
      })
      await this.prisma.artist.deleteMany({})

      this.logger.info('Cleanup: deleting tags...')
      onProgress?.({
        phase: 'cleanup',
        message: '正在删除标签数据...',
        percentage: 90
      })
      await this.prisma.tag.deleteMany({})

      onProgress?.({
        phase: 'cleanup',
        message: '数据清理完成',
        percentage: 100
      })

      this.logger.info('Cleaned up existing data for force update')
    } catch (error) {
      this.logger.error({ error }, 'Failed to cleanup existing data')
      throw error
    }
  }

  private async cleanupEmptyArtworks(): Promise<number> {
    try {
      // 查找没有图片的作品
      const emptyArtworks = await this.prisma.artwork.findMany({
        where: {
          images: {
            none: {}
          }
        },
        select: { id: true, title: true }
      })

      if (emptyArtworks.length > 0) {
        // 删除这些作品
        const artworkIds = emptyArtworks.map((a) => a.id)
        await this.prisma.artwork.deleteMany({
          where: { id: { in: artworkIds } }
        })

        this.logger.info(`Removed ${emptyArtworks.length} artworks without images`)
        return emptyArtworks.length
      }

      return 0
    } catch (error) {
      this.logger.error({ error }, 'Failed to cleanup empty artworks')
      return 0
    }
  }

  private async findOrCreateArtist(artistName: string) {
    try {
      // 解析艺术家名称，尝试拆分为用户名和用户ID
      const { displayName, username, userId } = this.parseArtistName(artistName)

      // 如果解析出了 username + userId，使用 upsert 基于复合唯一键避免竞态
      if (username && userId) {
        try {
          const created = await this.prisma.artist.create({
            data: {
              name: displayName,
              username,
              userId,
              bio: `Artist: ${username} (ID: ${userId})`
            }
          })
          this.logger.info(`Created new artist: ${displayName} (${username}, ${userId})`)
          return created
        } catch (e) {
          // 如果是重复键错误，则查询并返回已有记录
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const existing = await this.prisma.artist.findUnique({
              where: {
                unique_username_userid: { username, userId }
              } as any
            })
            if (existing) {
              this.logger.debug(`Found existing artist: ${displayName}`)
              return existing
            }
          }
          throw e
        }
      }

      // 否则按原始名称兜底（name 非唯一，无法使用 upsert）
      let artist = await this.prisma.artist.findFirst({
        where: { name: artistName }
      })

      if (!artist) {
        artist = await this.prisma.artist.create({
          data: {
            name: displayName,
            username: null,
            userId: null,
            bio: `Artist discovered from directory: ${artistName}`
          }
        })
        this.logger.info(`Created new artist: ${displayName}`)
      }

      return artist
    } catch (error) {
      this.logger.error({ error, artistName }, 'Failed to find or create artist')
      return null
    }
  }

  /**
   * 解析艺术家名称（优化版本）
   */
  private parseArtistName(artistName: string): {
    displayName: string
    username: string | null
    userId: string | null
  } {
    if (this.enableOptimizations) {
      return this.cacheManager.parseArtistName(artistName)
    }

    // 回退到原始实现
    // 优先匹配 "用户名 (用户ID)" 格式
    let match = artistName.match(/^(.+?)\s*\((\d+)\)$/)

    if (match) {
      const username = match[1].trim()
      const userId = match[2].trim()

      if (username.length > 0 && userId.length >= 1) {
        return {
          displayName: username,
          username: username,
          userId: userId
        }
      }
    }

    // 次优匹配 "用户名-数字ID" 或 "用户名-字母数字ID" 格式
    match = artistName.match(/^(.+?)-(\d+|[a-zA-Z0-9]+)$/)

    if (match) {
      const username = match[1].trim()
      const userId = match[2].trim()

      if (username.length > 0 && userId.length >= 1) {
        return {
          displayName: username,
          username: username,
          userId: userId
        }
      }
    }

    // 如果解析失败，返回原始名称
    return {
      displayName: artistName,
      username: null,
      userId: null
    }
  }

  private async createImageRecord(
    imagePath: string,
    artworkId: number,
    sortOrder: number,
    result: ScanResult
  ): Promise<void> {
    try {
      // 计算相对扫描根目录的相对路径（用于容器挂载路径统一）
      let relPath = imagePath
      const root = this.scanRootAbs
      if (root) {
        const maybeRel = path.relative(root, imagePath)
        if (!maybeRel.startsWith('..')) {
          relPath = maybeRel.replace(/\\/g, '/')
        }
      }

      // 去重：兼容历史绝对路径与新的相对路径
      const existingImage = await this.prisma.image.findFirst({
        where: { OR: [{ path: relPath }, { path: imagePath }] }
      })

      if (existingImage) {
        this.logger.debug(`Image already exists: ${relPath}`)
        return
      }

      // 获取图片文件信息
      const stats = await fs.stat(imagePath)

      // 创建图片记录（统一保存相对路径）
      await this.prisma.image.create({
        data: {
          path: relPath,
          size: stats.size,
          sortOrder: sortOrder,
          artworkId: artworkId
          // width 和 height 将在后续版本中通过 sharp 获取
        }
      })

      result.newImages++
      this.logger.debug(`Created image record: ${path.basename(imagePath)}`)
    } catch (error) {
      const errorMsg = `Failed to create image record for ${imagePath}: ${error instanceof Error ? error.message : 'Unknown error'}`
      result.errors.push(errorMsg)
      this.logger.warn({ error, imagePath }, 'Image record creation failed')
    }
  }
}
