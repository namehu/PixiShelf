import { PrismaClient, Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import {
  ArtistData,
  ArtworkData,
  ImageData,
  TagData,
  BatchResult,
  EntityMapping,
} from './types';
import { DatabaseOptimizer } from './DatabaseOptimizer';

/**
 * 流式批量处理器配置
 */
interface StreamingBatchConfig {
  microBatchSize: number;           // 微批量大小
  maxConcurrentFlushes: number;     // 最大并发刷新数
  flushInterval: number;            // 刷新间隔(ms)
  progressUpdateInterval: number;   // 进度更新间隔(ms)
  maxQueueSize: number;            // 最大队列大小
}

/**
 * 详细进度信息
 */
interface DetailedProgress {
  scanning: {
    processed: number;
    total: number;
    percentage: number;
  };
  batching: {
    artists: EntityProgress;
    artworks: EntityProgress;
    images: EntityProgress;
    tags: EntityProgress;
    artworkTags: EntityProgress;
  };
  overall: {
    phase: 'scanning' | 'batching' | 'finalizing';
    percentage: number;
    estimatedRemaining?: number;
  };
}

/**
 * 实体处理进度
 */
interface EntityProgress {
  processed: number;
  total: number;
  inQueue: number;
  processing: number;
}

/**
 * 微批量数据容器
 */
class MicroBatch<T> {
  private data: T[] = [];
  private readonly maxSize: number;
  
  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }
  
  add(item: T): boolean {
    if (this.data.length >= this.maxSize) {
      return false; // 需要刷新
    }
    this.data.push(item);
    return true;
  }
  
  flush(): T[] {
    const result = [...this.data];
    this.data = []; // 立即释放内存
    return result;
  }
  
  size(): number {
    return this.data.length;
  }
  
  isEmpty(): boolean {
    return this.data.length === 0;
  }
}

/**
 * 刷新任务
 */
interface FlushTask {
  id: string;
  type: 'artists' | 'artworks' | 'images' | 'tags' | 'artworkTags';
  data: any[];
  timestamp: number;
  retryCount: number;
}

/**
 * 异步刷新队列
 */
class AsyncFlushQueue {
  private queue: FlushTask[] = [];
  private processing: Set<string> = new Set();
  private readonly maxConcurrent: number;
  private readonly processor: StreamingBatchProcessor;
  
  constructor(maxConcurrent: number, processor: StreamingBatchProcessor) {
    this.maxConcurrent = maxConcurrent;
    this.processor = processor;
  }
  
  enqueue(task: FlushTask): void {
    this.queue.push(task);
    this.processNext();
  }
  
  private async processNext(): Promise<void> {
    if (this.processing.size >= this.maxConcurrent || this.queue.length === 0) {
      return;
    }
    
    const task = this.queue.shift()!;
    this.processing.add(task.id);
    
    try {
      await this.executeTask(task);
    } catch (error) {
      await this.handleTaskError(task, error);
    } finally {
      this.processing.delete(task.id);
      // 继续处理下一个任务
      setImmediate(() => this.processNext());
    }
  }
  
  private async executeTask(task: FlushTask): Promise<void> {
    switch (task.type) {
      case 'artists':
        await this.processor.flushArtists(task.data);
        break;
      case 'artworks':
        await this.processor.flushArtworks(task.data);
        break;
      case 'images':
        await this.processor.flushImages(task.data);
        break;
      case 'tags':
        await this.processor.flushTags(task.data);
        break;
      case 'artworkTags':
        await this.processor.flushArtworkTags(task.data);
        break;
    }
    
    this.processor.updateProgress(task.type, task.data.length);
  }
  
  private async handleTaskError(task: FlushTask, error: any): Promise<void> {
    if (task.retryCount < 3) {
      // 重试机制
      task.retryCount++;
      setTimeout(() => this.enqueue(task), 1000 * task.retryCount);
    } else {
      // 记录错误并继续
      this.processor.recordError(task.type, error, task.data.length);
    }
  }
  
  getStatus(): { queued: number; processing: number } {
    return {
      queued: this.queue.length,
      processing: this.processing.size
    };
  }
}

/**
 * 流式批量处理器
 * 解决传统批量处理器的阻塞问题
 */
export class StreamingBatchProcessor {
  private prisma: PrismaClient;
  private logger: FastifyInstance['log'];
  private config: StreamingBatchConfig;
  private dbOptimizer: DatabaseOptimizer;
  
  // 微批量容器
  private artistsBatch!: MicroBatch<ArtistData>;
  private artworksBatch!: MicroBatch<ArtworkData & { artistName: string }>;
  private imagesBatch!: MicroBatch<ImageData & { artworkTitle: string; artistName: string }>;
  private tagsBatch!: MicroBatch<TagData>;
  private artworkTagsBatch!: MicroBatch<{ artworkTitle: string; artistName: string; tagName: string }>;
  
  // 异步处理队列
  private flushQueue!: AsyncFlushQueue;
  
  // 实体映射
  private entityMapping!: EntityMapping;
  
  // 进度跟踪
  private progressStats!: {
    artists: EntityProgress;
    artworks: EntityProgress;
    images: EntityProgress;
    tags: EntityProgress;
    artworkTags: EntityProgress;
  };
  
  // 结果统计
  private result!: BatchResult;
  
  // 进度回调
  private onProgress?: (progress: DetailedProgress) => void;
  
  // 定时器
  private progressTimer?: NodeJS.Timeout;
  
  constructor(
    prisma: PrismaClient,
    logger: FastifyInstance['log'],
    config: Partial<StreamingBatchConfig> = {},
    onProgress?: (progress: DetailedProgress) => void
  ) {
    this.prisma = prisma;
    this.logger = logger;
    this.onProgress = onProgress;
    
    this.config = {
      microBatchSize: 50,
      maxConcurrentFlushes: 3,
      flushInterval: 2000,
      progressUpdateInterval: 1000,
      maxQueueSize: 1000,
      ...config,
    };
    
    // 初始化数据库优化器
    this.dbOptimizer = new DatabaseOptimizer(prisma, logger, {
      connectionPoolSize: this.config.maxConcurrentFlushes * 2,
      queryTimeout: 30000,
      batchTimeout: this.config.flushInterval,
      retryAttempts: 3,
      enableQueryOptimization: true,
      enableTransactionBatching: true,
    });
    
    this.initializeBatches();
    this.initializeProgress();
    this.initializeResult();
    this.initializeEntityMapping();
    
    this.flushQueue = new AsyncFlushQueue(this.config.maxConcurrentFlushes, this);
    
    this.startProgressTimer();
  }
  
  private initializeBatches(): void {
    this.artistsBatch = new MicroBatch(this.config.microBatchSize);
    this.artworksBatch = new MicroBatch(this.config.microBatchSize);
    this.imagesBatch = new MicroBatch(this.config.microBatchSize);
    this.tagsBatch = new MicroBatch(this.config.microBatchSize);
    this.artworkTagsBatch = new MicroBatch(this.config.microBatchSize);
  }
  
  private initializeProgress(): void {
    this.progressStats = {
      artists: { processed: 0, total: 0, inQueue: 0, processing: 0 },
      artworks: { processed: 0, total: 0, inQueue: 0, processing: 0 },
      images: { processed: 0, total: 0, inQueue: 0, processing: 0 },
      tags: { processed: 0, total: 0, inQueue: 0, processing: 0 },
      artworkTags: { processed: 0, total: 0, inQueue: 0, processing: 0 },
    };
  }
  
  private initializeResult(): void {
    this.result = {
      artistsCreated: 0,
      artistsUpdated: 0,
      artworksCreated: 0,
      artworksUpdated: 0,
      imagesCreated: 0,
      tagsCreated: 0,
      artworkTagsCreated: 0,
      errors: [],
      duplicatesSkipped: 0,
      processingTime: 0,
    };
  }
  
  private initializeEntityMapping(): void {
    this.entityMapping = {
      artists: new Map(),
      artworks: new Map(),
      tags: new Map(),
    };
  }
  
  private startProgressTimer(): void {
    this.progressTimer = setInterval(() => {
      this.emitProgress();
    }, this.config.progressUpdateInterval);
  }
  
  /**
   * 添加艺术家数据
   */
  addArtist(artistData: ArtistData): void {
    if (!this.artistsBatch.add(artistData)) {
      this.scheduleFlush('artists', this.artistsBatch.flush());
      this.artistsBatch.add(artistData); // 添加到新批次
    }
    this.progressStats.artists.total++;
  }
  
  /**
   * 添加作品数据
   */
  addArtwork(artworkData: ArtworkData & { artistName: string }): void {
    if (!this.artworksBatch.add(artworkData)) {
      this.scheduleFlush('artworks', this.artworksBatch.flush());
      this.artworksBatch.add(artworkData);
    }
    this.progressStats.artworks.total++;
  }
  
  /**
   * 添加图片数据
   */
  addImage(imageData: ImageData & { artworkTitle: string; artistName: string }): void {
    if (!this.imagesBatch.add(imageData)) {
      this.scheduleFlush('images', this.imagesBatch.flush());
      this.imagesBatch.add(imageData);
    }
    this.progressStats.images.total++;
  }
  
  /**
   * 添加标签数据
   */
  addTag(tagData: TagData): void {
    if (!this.tagsBatch.add(tagData)) {
      this.scheduleFlush('tags', this.tagsBatch.flush());
      this.tagsBatch.add(tagData);
    }
    this.progressStats.tags.total++;
  }
  
  /**
   * 添加作品标签关联
   */
  addArtworkTag(artworkTitle: string, artistName: string, tagName: string): void {
    const data = { artworkTitle, artistName, tagName };
    if (!this.artworkTagsBatch.add(data)) {
      this.scheduleFlush('artworkTags', this.artworkTagsBatch.flush());
      this.artworkTagsBatch.add(data);
    }
    this.progressStats.artworkTags.total++;
  }
  
  /**
   * 调度刷新任务
   */
  private scheduleFlush(type: FlushTask['type'], data: any[]): void {
    if (data.length === 0) return;
    
    const task: FlushTask = {
      id: `${type}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type,
      data,
      timestamp: Date.now(),
      retryCount: 0,
    };
    
    this.flushQueue.enqueue(task);
    this.progressStats[type].inQueue += data.length;
  }
  
  /**
   * 刷新艺术家数据
   */
  async flushArtists(artists: ArtistData[]): Promise<void> {
    if (artists.length === 0) return;
    
    this.progressStats.artists.processing += artists.length;
    
    try {
      const result = await this.dbOptimizer.batchCreateAndReturn<any>(
        'artist',
        artists,
        { skipDuplicates: true }
      );
      
      if (result.success && result.data) {
        const createdArtists = result.data;
        
        // 更新映射
        for (const artist of createdArtists) {
          const key = this.getArtistKey(artist);
          this.entityMapping.artists.set(key, artist.id);
        }
        
        this.result.artistsCreated += createdArtists.length;
        this.result.duplicatesSkipped += artists.length - createdArtists.length;
        
        this.logger.debug(
          { 
            created: createdArtists.length, 
            duplicates: artists.length - createdArtists.length,
            executionTime: result.executionTime,
            retryCount: result.retryCount
          }, 
          'Artists flushed successfully'
        );
      } else {
        throw new Error(result.error || 'Failed to create artists');
      }
      
    } catch (error) {
      this.logger.error({ error, count: artists.length }, 'Failed to flush artists');
      throw error;
    } finally {
      this.progressStats.artists.processing -= artists.length;
    }
  }
  
  /**
   * 刷新作品数据
   */
  async flushArtworks(artworks: (ArtworkData & { artistName: string })[]): Promise<void> {
    if (artworks.length === 0) return;
    
    this.progressStats.artworks.processing += artworks.length;
    
    try {
      // 解析艺术家ID
      const artworksWithArtistId = artworks.map(artwork => {
        const artistKey = this.getArtistKeyFromName(artwork.artistName);
        const artistId = this.entityMapping.artists.get(artistKey);
        
        if (!artistId) {
          throw new Error(`Artist not found: ${artwork.artistName}`);
        }
        
        return {
          title: artwork.title,
          description: artwork.description,
          artistId,
          directoryCreatedAt: artwork.directoryCreatedAt,
          imageCount: artwork.imageCount,
          descriptionLength: artwork.descriptionLength
        };
      });
      
      const createdArtworks = await this.prisma.artwork.createManyAndReturn({
        data: artworksWithArtistId,
        skipDuplicates: true,
      });
      
      // 更新映射
      for (let i = 0; i < createdArtworks.length; i++) {
        const artwork = createdArtworks[i];
        const originalData = artworks[i];
        const key = this.getArtworkKey(artwork.title, originalData.artistName);
        this.entityMapping.artworks.set(key, artwork.id);
      }
      
      this.result.artworksCreated += createdArtworks.length;
      this.result.duplicatesSkipped += artworks.length - createdArtworks.length;
      
    } catch (error) {
      this.logger.error({ error, count: artworks.length }, 'Failed to flush artworks');
      throw error;
    } finally {
      this.progressStats.artworks.processing -= artworks.length;
    }
  }
  
  /**
   * 刷新图片数据
   */
  async flushImages(images: (ImageData & { artworkTitle: string; artistName: string })[]): Promise<void> {
    if (images.length === 0) return;
    
    this.progressStats.images.processing += images.length;
    
    try {
      // 解析作品ID
      const imagesWithArtworkId = images.map(image => {
        const artworkKey = this.getArtworkKey(image.artworkTitle, image.artistName);
        const artworkId = this.entityMapping.artworks.get(artworkKey);
        
        if (!artworkId) {
          throw new Error(`Artwork not found: ${image.artworkTitle} by ${image.artistName}`);
        }
        
        return {
          path: image.path,
          size: image.size,
          width: image.width,
          height: image.height,
          sortOrder: image.sortOrder,
          artworkId,
        };
      });
      
      const result = await this.dbOptimizer.batchCreate<any>(
        'image',
        imagesWithArtworkId,
        { skipDuplicates: true }
      );
      
      if (result.success && result.data) {
        this.result.imagesCreated += result.data.count || imagesWithArtworkId.length;
        
        this.logger.debug(
          { 
            created: result.data.count || imagesWithArtworkId.length,
            executionTime: result.executionTime,
            retryCount: result.retryCount
          }, 
          'Images flushed successfully'
        );
      } else {
        throw new Error(result.error || 'Failed to create images');
      }
      
    } catch (error) {
      this.logger.error({ error, count: images.length }, 'Failed to flush images');
      throw error;
    } finally {
      this.progressStats.images.processing -= images.length;
    }
  }
  
  /**
   * 刷新标签数据
   */
  async flushTags(tags: TagData[]): Promise<void> {
    if (tags.length === 0) return;
    
    this.progressStats.tags.processing += tags.length;
    
    try {
      const createdTags = await this.prisma.tag.createManyAndReturn({
        data: tags,
        skipDuplicates: true,
      });
      
      // 更新映射
      for (const tag of createdTags) {
        this.entityMapping.tags.set(tag.name, tag.id);
      }
      
      this.result.tagsCreated += createdTags.length;
      this.result.duplicatesSkipped += tags.length - createdTags.length;
      
    } catch (error) {
      this.logger.error({ error, count: tags.length }, 'Failed to flush tags');
      throw error;
    } finally {
      this.progressStats.tags.processing -= tags.length;
    }
  }
  
  /**
   * 刷新作品标签关联
   */
  async flushArtworkTags(artworkTags: { artworkTitle: string; artistName: string; tagName: string }[]): Promise<void> {
    if (artworkTags.length === 0) return;
    
    this.progressStats.artworkTags.processing += artworkTags.length;
    
    try {
      // 解析ID
      const artworkTagsWithIds = artworkTags.map(item => {
        const artworkKey = this.getArtworkKey(item.artworkTitle, item.artistName);
        const artworkId = this.entityMapping.artworks.get(artworkKey);
        const tagId = this.entityMapping.tags.get(item.tagName);
        
        if (!artworkId || !tagId) {
          throw new Error(`Missing mapping: artwork=${artworkId}, tag=${tagId}`);
        }
        
        return { artworkId, tagId };
      });
      
      const created = await this.prisma.artworkTag.createMany({
        data: artworkTagsWithIds,
        skipDuplicates: true,
      });
      
      this.result.artworkTagsCreated += created.count;
      
    } catch (error) {
      this.logger.error({ error, count: artworkTags.length }, 'Failed to flush artwork tags');
      throw error;
    } finally {
      this.progressStats.artworkTags.processing -= artworkTags.length;
    }
  }
  
  /**
   * 更新进度
   */
  updateProgress(type: keyof typeof this.progressStats, count: number): void {
    this.progressStats[type].processed += count;
    this.progressStats[type].inQueue -= count;
  }
  
  /**
   * 记录错误
   */
  recordError(type: string, error: any, count: number): void {
    this.result.errors.push({
      type: type as 'artist' | 'artwork' | 'image' | 'tag' | 'artworkTag',
      data: null,
      error: error instanceof Error ? error.message : String(error),
    });
    
    // 更新进度（即使失败也要计入处理数）
    this.updateProgress(type as keyof typeof this.progressStats, count);
  }
  
  /**
   * 发送进度更新
   */
  private emitProgress(): void {
    if (!this.onProgress) return;
    
    const queueStatus = this.flushQueue.getStatus();
    
    const detailedProgress: DetailedProgress = {
      scanning: {
        processed: 0, // 由外部设置
        total: 0,     // 由外部设置
        percentage: 0, // 由外部设置
      },
      batching: {
        artists: { ...this.progressStats.artists },
        artworks: { ...this.progressStats.artworks },
        images: { ...this.progressStats.images },
        tags: { ...this.progressStats.tags },
        artworkTags: { ...this.progressStats.artworkTags },
      },
      overall: {
        phase: 'batching',
        percentage: this.calculateBatchingProgress(),
      },
    };
    
    this.onProgress(detailedProgress);
  }
  
  /**
   * 计算批量处理进度
   */
  private calculateBatchingProgress(): number {
    const weights = {
      artists: 0.1,
      artworks: 0.2,
      images: 0.6,
      tags: 0.05,
      artworkTags: 0.05,
    };
    
    let totalProgress = 0;
    
    for (const [type, weight] of Object.entries(weights)) {
      const stats = this.progressStats[type as keyof typeof this.progressStats];
      const progress = stats.total > 0 ? stats.processed / stats.total : 0;
      totalProgress += progress * weight;
    }
    
    return Math.floor(totalProgress * 100);
  }
  
  /**
   * 最终化处理
   */
  async finalize(): Promise<BatchResult> {
    // 刷新剩余的微批量
    this.scheduleFlush('artists', this.artistsBatch.flush());
    this.scheduleFlush('artworks', this.artworksBatch.flush());
    this.scheduleFlush('images', this.imagesBatch.flush());
    this.scheduleFlush('tags', this.tagsBatch.flush());
    this.scheduleFlush('artworkTags', this.artworkTagsBatch.flush());
    
    // 等待所有任务完成
    while (this.flushQueue.getStatus().queued > 0 || this.flushQueue.getStatus().processing > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    // 停止进度定时器
    if (this.progressTimer) {
      clearInterval(this.progressTimer);
    }
    
    // 清理数据库优化器资源
    this.dbOptimizer.cleanup();
    
    // 记录最终性能统计
    const dbStats = this.dbOptimizer.getStats();
    this.logger.info(
      {
        batchResult: this.result,
        databaseStats: dbStats,
        healthStatus: this.dbOptimizer.getHealthStatus()
      },
      'Streaming batch processing completed'
    );
    
    return this.result;
  }
  
  /**
   * 获取统计信息
   */
  getStats() {
    const queueStatus = this.flushQueue.getStatus();
    
    return {
      batches: {
        artists: this.artistsBatch.size(),
        artworks: this.artworksBatch.size(),
        images: this.imagesBatch.size(),
        tags: this.tagsBatch.size(),
        artworkTags: this.artworkTagsBatch.size(),
      },
      queue: queueStatus,
      progress: { ...this.progressStats },
      result: { ...this.result },
    };
  }
  
  /**
   * 检查是否应该开始微刷新
   */
  shouldStartMicroFlush(): boolean {
    const queueStatus = this.flushQueue.getStatus();
    return queueStatus.queued < this.config.maxQueueSize;
  }
  
  // 辅助方法
  private getArtistKey(artist: { name: string; username?: string | null; userId?: string | null }): string {
    return `${artist.name}|${artist.username || ''}|${artist.userId || ''}`;
  }
  
  private getArtistKeyFromName(artistName: string): string {
    const parsed = this.parseArtistName(artistName);
    return `${parsed.displayName}|${parsed.username || ''}|${parsed.userId || ''}`;
  }
  
  private getArtworkKey(title: string, artistName: string): string {
    return `${title}|${artistName}`;
  }
  
  private parseArtistName(artistName: string): {
    displayName: string;
    username: string | null;
    userId: string | null;
  } {
    // 优先匹配 "用户名 (用户ID)" 格式
    let match = artistName.match(/^(.+?)\s*\((\d+)\)$/);

    if (match) {
      const username = match[1].trim();
      const userId = match[2].trim();

      if (username.length > 0 && userId.length >= 1) {
        return {
          displayName: username,
          username: username,
          userId: userId,
        };
      }
    }

    // 次优匹配 "用户名-数字ID" 或 "用户名-字母数字ID" 格式
    match = artistName.match(/^(.+?)-(\d+|[a-zA-Z0-9]+)$/);

    if (match) {
      const username = match[1].trim();
      const userId = match[2].trim();

      if (username.length > 0 && userId.length >= 1) {
        return {
          displayName: username,
          username: username,
          userId: userId,
        };
      }
    }

    // 如果解析失败，返回原始名称
    return {
      displayName: artistName,
      username: null,
      userId: null,
    };
  }
}