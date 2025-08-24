import { promises as fs } from 'fs'
import path from 'path'
import { PrismaClient } from '@prisma/client'
import { FastifyInstance } from 'fastify'
import {
  ProcessOptions,
  ProcessResult,
  ProcessProgress,
  ArtworkProcessResult,
  ProcessingQueue,
  PerformanceMetrics,
  ProcessingStage
} from '@pixishelf/shared'
import { ArtworkProcessor } from './ArtworkProcessor'
import { StreamController } from './StreamController'
import { BatchProcessor } from './BatchProcessor'
import { ConcurrencyController } from './ConcurrencyController'

/**
 * 流水线处理器
 * 负责管理文件发现、队列处理、批处理协调和并发控制
 */
export class PipelineProcessor {
  private artworkProcessor: ArtworkProcessor
  private streamController: StreamController
  private batchProcessor: BatchProcessor
  private concurrencyController: ConcurrencyController
  private logger: FastifyInstance['log']
  private prisma: PrismaClient
  private currentBatch: {
    artists: any[]
    artworks: any[]
    images: any[]
    tags: any[]
  }

  constructor(
    prisma: PrismaClient,
    logger: FastifyInstance['log'],
    options: {
      maxConcurrency?: number
      batchSize?: number
    } = {}
  ) {
    this.prisma = prisma
    this.logger = logger
    this.artworkProcessor = new ArtworkProcessor(logger)
    this.streamController = new StreamController(logger, {
      maxMemoryUsage: 1024 * 1024 * 1024, // 1GB
      batchFlushThreshold: options.batchSize || 50,
      concurrencyAdjustmentFactor: 0.1,
      memoryCheckInterval: 1000,
      performanceSampleInterval: 5000
    })
    this.batchProcessor = new BatchProcessor(prisma, logger)
    this.concurrencyController = new ConcurrencyController(options.maxConcurrency || 4)
    
    this.currentBatch = {
      artists: [],
      artworks: [],
      images: [],
      tags: []
    }
  }

  /**
   * 处理文件
   * @param scanPath 扫描路径
   * @param options 处理选项
   * @returns 处理结果
   */
  async processFiles(scanPath: string, options: ProcessOptions): Promise<ProcessResult> {
    const result: ProcessResult = this.initializeResult()
    const startTime = Date.now()

    try {
      this.logger.info({ scanPath }, 'Starting pipeline processing')

      // 1. 发现所有元数据文件
      const metadataFiles = await this.discoverFiles(scanPath)
      result.totalFiles = metadataFiles.length
      
      this.logger.info({ 
        totalFiles: result.totalFiles,
        scanPath 
      }, 'Discovered metadata files')

      if (metadataFiles.length === 0) {
        this.logger.warn('No metadata files found')
        return result
      }

      // 2. 创建处理队列
      const queue = await this.createProcessingQueue(metadataFiles)
      
      // 3. 流式处理文件
      await this.processFileStream(queue, result, options)
      
      // 4. 最终批处理提交
      await this.finalFlush(result)
      
      // 5. 计算性能指标
      result.performance = this.calculatePerformanceMetrics(startTime)
      
      this.logger.info({
        totalFiles: result.totalFiles,
        processedFiles: result.processedFiles,
        successfulFiles: result.successfulFiles,
        failedFiles: result.failedFiles,
        duration: result.performance.duration
      }, 'Pipeline processing completed')

      return result

    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger.error({ error: errorMessage, scanPath }, 'Pipeline processing failed')
      result.errors.push(errorMessage)
      return result
    } finally {
      this.streamController.stop()
    }
  }

  /**
   * 发现文件
   * @param scanPath 扫描路径
   * @returns 元数据文件列表
   */
  private async discoverFiles(scanPath: string): Promise<string[]> {
    const metadataFiles: string[] = []
    
    try {
      await this.discoverFilesRecursive(scanPath, metadataFiles)
    } catch (error) {
      this.logger.error({ error, scanPath }, 'Failed to discover files')
      throw error
    }
    
    return metadataFiles.sort() // 确保处理顺序一致
  }

  /**
   * 递归发现文件
   * @param dirPath 目录路径
   * @param metadataFiles 元数据文件列表
   */
  private async discoverFilesRecursive(dirPath: string, metadataFiles: string[]): Promise<void> {
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true })
      
      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        
        if (entry.isDirectory()) {
          // 递归处理子目录
          await this.discoverFilesRecursive(fullPath, metadataFiles)
        } else if (entry.isFile() && this.isMetadataFile(entry.name)) {
          metadataFiles.push(fullPath)
        }
      }
    } catch (error) {
      this.logger.error({ error, dirPath }, 'Failed to read directory')
      // 继续处理其他目录，不抛出错误
    }
  }

  /**
   * 检查是否为元数据文件
   * @param filename 文件名
   * @returns 是否为元数据文件
   */
  private isMetadataFile(filename: string): boolean {
    return filename.toLowerCase().endsWith('-meta.txt')
  }

  /**
   * 创建处理队列
   * @param files 文件列表
   * @returns 处理队列
   */
  private async createProcessingQueue(files: string[]): Promise<ProcessingQueue> {
    return {
      files,
      currentIndex: 0,
      totalCount: files.length,
      isCompleted: false
    }
  }

  /**
   * 流式处理文件
   * @param queue 处理队列
   * @param result 处理结果
   * @param options 处理选项
   */
  private async processFileStream(
    queue: ProcessingQueue,
    result: ProcessResult,
    options: ProcessOptions
  ): Promise<void> {
    // 创建处理任务
    const tasks = queue.files.map(file => async () => {
      try {
        // 检查是否应该继续处理
        if (!this.streamController.shouldProcessNext()) {
          await this.streamController.waitForMemoryAvailable()
        }

        const processingStart = Date.now()
        
        // 处理单个作品
        const artworkResult = await this.artworkProcessor.processArtwork(file)
        
        const processingTime = Date.now() - processingStart
        
        // 添加到批处理
        await this.addToBatch(artworkResult)
        
        // 检查是否需要提交批次
        if (this.streamController.shouldFlushBatch()) {
          await this.flushBatch(result)
        }
        
        // 更新结果统计
        result.processedFiles++
        if (artworkResult.success) {
          result.successfulFiles++
          result.newArtworks++
          result.newImages += artworkResult.images?.length || 0
        } else {
          result.failedFiles++
          result.errors.push(...artworkResult.errors)
        }
        
        // 调整并发数
        this.streamController.adjustConcurrency(processingTime)
        
        // 更新进度
        this.updateProgress(result, options)
        
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error)
        this.logger.error({ file, error: errorMessage }, 'Failed to process artwork')
        result.errors.push(`${file}: ${errorMessage}`)
        result.failedFiles++
        options.onError?.(error instanceof Error ? error : new Error(errorMessage))
      }
    })
    
    // 并发执行任务
    await this.concurrencyController.executeAll(tasks)
  }

  /**
   * 添加到批处理
   * @param artworkResult 作品处理结果
   */
  private async addToBatch(artworkResult: ArtworkProcessResult): Promise<void> {
    if (!artworkResult.success) {
      return
    }

    // 添加艺术家数据
    if (artworkResult.artist) {
      this.currentBatch.artists.push(artworkResult.artist)
    }
    
    // 添加作品数据
    if (artworkResult.artwork) {
      this.currentBatch.artworks.push(artworkResult.artwork)
    }
    
    // 添加图片数据
    if (artworkResult.images && artworkResult.images.length > 0) {
      this.currentBatch.images.push(...artworkResult.images)
    }
    
    // 添加标签数据
    if (artworkResult.tags && artworkResult.tags.length > 0) {
      this.currentBatch.tags.push(...artworkResult.tags)
    }
    
    // 更新批处理指标
    this.streamController.updateBatchMetrics(1)
  }

  /**
   * 刷新批处理
   * @param result 处理结果
   */
  private async flushBatch(result: ProcessResult): Promise<void> {
    if (this.isBatchEmpty()) {
      return
    }

    const flushStart = Date.now()
    
    try {
      this.logger.debug({
        artists: this.currentBatch.artists.length,
        artworks: this.currentBatch.artworks.length,
        images: this.currentBatch.images.length,
        tags: this.currentBatch.tags.length
      }, 'Flushing batch to database')

      // 批量处理艺术家
      for (const artist of this.currentBatch.artists) {
        this.batchProcessor.addArtist(artist)
      }
      
      // 批量处理作品
      for (const artwork of this.currentBatch.artworks) {
        this.batchProcessor.addArtwork(artwork)
      }
      
      // 批量处理图片
      for (const image of this.currentBatch.images) {
        this.batchProcessor.addImage(image)
      }
      
      // 批量处理标签
      for (const tag of this.currentBatch.tags) {
        this.batchProcessor.addTag(tag)
      }
      
      // 提交批处理
      const batchResult = await this.batchProcessor.flush()
      
      // 更新统计
      result.scannedDirectories += batchResult.artistsCreated + batchResult.artistsUpdated
      result.foundImages += this.currentBatch.images.length
      result.metadataFiles += this.currentBatch.artworks.length
      result.processedMetadata += this.currentBatch.artworks.length
      
      const flushTime = Date.now() - flushStart
      this.logger.debug({ flushTime, batchSize: this.getBatchSize() }, 'Batch flushed successfully')
      
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      this.logger.error({ error: errorMessage }, 'Failed to flush batch')
      result.errors.push(`Batch flush failed: ${errorMessage}`)
    } finally {
      // 清空当前批次
      this.clearBatch()
      this.streamController.resetBatchMetrics()
    }
  }

  /**
   * 最终刷新
   * @param result 处理结果
   */
  private async finalFlush(result: ProcessResult): Promise<void> {
    if (!this.isBatchEmpty()) {
      this.logger.info('Performing final batch flush')
      await this.flushBatch(result)
    }
  }

  /**
   * 更新进度
   * @param result 处理结果
   * @param options 处理选项
   */
  private updateProgress(result: ProcessResult, options: ProcessOptions): void {
    const progress: ProcessProgress = {
      processed: result.processedFiles,
      total: result.totalFiles
    }
    
    options.onProgress?.(progress)
  }

  /**
   * 计算性能指标
   * @param startTime 开始时间
   * @returns 性能指标
   */
  private calculatePerformanceMetrics(startTime: number): PerformanceMetrics {
    const duration = Date.now() - startTime
    const controllerStats = this.streamController.getControllerStats()
    
    return {
      duration,
      throughput: 0, // 将在上层计算
      memoryUsage: controllerStats.memoryUsage,
      concurrencyStats: {
        maxConcurrency: controllerStats.maxConcurrency,
        avgConcurrency: controllerStats.currentConcurrency,
        currentConcurrency: controllerStats.currentConcurrency,
        peakQueueLength: 0,
        currentQueueLength: 0,
        efficiency: 0.8 // 默认效率
      },
      batchStats: {
        totalBatches: 0,
        avgBatchSize: 0,
        totalBatchTime: 0,
        avgBatchTime: 0,
        batchEfficiency: 0.9 // 默认效率
      },
      errorStats: {
        totalErrors: 0,
        errorRate: 0,
        errorsByType: {},
        errorsByStage: {
          discovery: 0,
          metadata_parsing: 0,
          media_association: 0,
          data_generation: 0,
          validation: 0,
          batch_processing: 0,
          completed: 0,
          failed: 0
        }
      }
    }
  }

  /**
   * 初始化结果
   * @returns 初始化的处理结果
   */
  private initializeResult(): ProcessResult {
    return {
      totalFiles: 0,
      processedFiles: 0,
      successfulFiles: 0,
      failedFiles: 0,
      errors: [],
      performance: {} as PerformanceMetrics,
      scannedDirectories: 0,
      foundImages: 0,
      newArtworks: 0,
      newImages: 0,
      skippedDirectories: [],
      metadataFiles: 0,
      processedMetadata: 0,
      skippedMetadata: []
    }
  }

  /**
   * 检查批次是否为空
   * @returns 批次是否为空
   */
  private isBatchEmpty(): boolean {
    return this.currentBatch.artists.length === 0 &&
           this.currentBatch.artworks.length === 0 &&
           this.currentBatch.images.length === 0 &&
           this.currentBatch.tags.length === 0
  }

  /**
   * 获取批次大小
   * @returns 批次大小
   */
  private getBatchSize(): number {
    return this.currentBatch.artists.length +
           this.currentBatch.artworks.length +
           this.currentBatch.images.length +
           this.currentBatch.tags.length
  }

  /**
   * 清空批次
   */
  private clearBatch(): void {
    this.currentBatch.artists = []
    this.currentBatch.artworks = []
    this.currentBatch.images = []
    this.currentBatch.tags = []
  }
}