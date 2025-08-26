import { promises as fs } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
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
  private useStreamingBatch: boolean = true

  // 新增：扫描编排器
  private scanOrchestrator: ScanOrchestrator
  private enableMetadataScanning: boolean = true

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
    this.enableMetadataScanning = options?.enableMetadataScanning ?? true

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
      enableOptimizations: true,
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
          const reason = 'Artist directory name contains unsupported characters'
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
          const reason = 'Artwork directory name contains unsupported characters'
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
      optimizationsEnabled: true
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
    return this.cacheManager.isValidName(name)
  }

  /**
   * 新的扫描方法，支持元数据扫描
   * @param options 扩展的扫描选项
   * @returns 扫描结果
   */
  async scanWithMetadata(options: ExtendedScanOptions): Promise<ExtendedScanResult> {
    try {
      this.logger.info('Starting metadata-enabled scan')

      return await this.scanOrchestrator.scan(options)
    } catch (error) {
      this.logger.error({ error, options }, 'Metadata scan failed')
      throw error
    }
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

      // 使用统一的优化扫描策略
      await this.scanOptimized(scanPath, extensions, result, onProgress)

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
  // scanArtistDirectories method removed - only used by legacy scanning

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
}
