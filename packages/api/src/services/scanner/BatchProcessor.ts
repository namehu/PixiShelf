import { PrismaClient, Prisma } from '@prisma/client';
import { FastifyInstance } from 'fastify';
import {
  ArtistData,
  ArtworkData,
  ImageData,
  TagData,
  BatchData,
  BatchResult,
  BatchConfig,
  BatchProgress,
  EntityMapping,
} from './types';

/**
 * 批量数据库操作处理器
 * 用于优化大量数据的插入和更新操作
 */
export class BatchProcessor {
  private prisma: PrismaClient;
  private logger: FastifyInstance['log'];
  private config: BatchConfig;
  private batchData!: BatchData;
  private entityMapping!: EntityMapping;
  private onProgress?: (progress: BatchProgress) => void;
  private lastFlushTime: number = Date.now();
  private streamMode: boolean = false;

  constructor(
    prisma: PrismaClient,
    logger: FastifyInstance['log'],
    config: Partial<BatchConfig> = {},
    onProgress?: (progress: BatchProgress) => void
  ) {
    this.prisma = prisma;
    this.logger = logger;
    this.onProgress = onProgress;
    this.config = {
      batchSize: 1000,
      maxRetries: 3,
      retryDelay: 1000,
      enableDeduplication: true,
      enableProgressCallback: true,
      ...config,
    };
    this.initializeBatchData();
    this.initializeEntityMapping();
  }

  /**
   * 初始化批量数据容器
   */
  private initializeBatchData(): void {
    this.batchData = {
      artists: new Map(),
      artworks: [],
      images: [],
      tags: new Map(),
      artworkTags: [],
    };
  }

  /**
   * 初始化实体映射
   */
  private initializeEntityMapping(): void {
    this.entityMapping = {
      artists: new Map(),
      artworks: new Map(),
      tags: new Map(),
    };
  }

  /**
   * 添加艺术家数据
   */
  addArtist(artistData: ArtistData): void {
    const key = this.getArtistKey(artistData);
    if (!this.batchData.artists.has(key)) {
      this.batchData.artists.set(key, artistData);
    }
  }

  /**
   * 添加作品数据
   */
  addArtwork(artworkData: ArtworkData & { artistName: string }): void {
    const tempId = this.generateTempId('artwork', artworkData.title, artworkData.artistName);
    this.batchData.artworks.push({
      ...artworkData,
      tempId,
    });
  }

  /**
   * 添加图片数据
   */
  addImage(imageData: ImageData & { artworkTitle: string; artistName: string }): void {
    const tempArtworkId = this.generateTempId('artwork', imageData.artworkTitle, imageData.artistName);
    this.batchData.images.push({
      ...imageData,
      tempArtworkId,
    });
  }

  /**
   * 添加标签数据
   */
  addTag(tagData: TagData): void {
    if (!this.batchData.tags.has(tagData.name)) {
      this.batchData.tags.set(tagData.name, tagData);
    }
  }

  /**
   * 添加作品-标签关联
   */
  addArtworkTag(artworkTitle: string, artistName: string, tagName: string): void {
    const tempArtworkId = this.generateTempId('artwork', artworkTitle, artistName);
    this.batchData.artworkTags.push({
      tempArtworkId,
      tagName,
    });
  }

  /**
   * 执行批量处理
   */
  async flush(): Promise<BatchResult> {
    const startTime = Date.now();
    const result: BatchResult = {
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

    try {
      // 预加载现有实体映射
      await this.preloadEntityMappings();

      // 按顺序处理各类数据
      await this.processArtists(result);
      await this.processArtworks(result);
      await this.processTags(result);
      await this.processImages(result);
      await this.processArtworkTags(result);

      result.processingTime = Date.now() - startTime;
      this.logger.info({ result }, 'Batch processing completed');

      // 清理批量数据
      this.initializeBatchData();

      return result;
    } catch (error) {
      result.processingTime = Date.now() - startTime;
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push({
        type: 'artist',
        data: null,
        error: `Batch processing failed: ${errorMsg}`,
      });
      this.logger.error({ error }, 'Batch processing failed');
      return result;
    }
  }

  /**
   * 预加载现有实体映射
   */
  private async preloadEntityMappings(): Promise<void> {
    this.reportProgress('preparing', 0, 3, 0, 1, 'Loading existing entities');

    // 加载现有艺术家
    const existingArtists = await this.prisma.artist.findMany({
      select: { id: true, name: true, username: true, userId: true },
    });
    
    for (const artist of existingArtists) {
      const key = this.getArtistKeyFromDb(artist);
      this.entityMapping.artists.set(key, artist.id);
    }

    // 加载现有标签
    const existingTags = await this.prisma.tag.findMany({
      select: { id: true, name: true },
    });
    
    for (const tag of existingTags) {
      this.entityMapping.tags.set(tag.name, tag.id);
    }

    this.logger.info(
      {
        artists: this.entityMapping.artists.size,
        tags: this.entityMapping.tags.size,
      },
      'Preloaded entity mappings'
    );
  }

  /**
   * 处理艺术家数据
   */
  private async processArtists(result: BatchResult): Promise<void> {
    const artists = Array.from(this.batchData.artists.values());
    if (artists.length === 0) {
      this.logger.info('No artists to process');
      return;
    }

    this.logger.info({ artistCount: artists.length }, 'Processing artists');
    this.reportProgress('artists', 0, artists.length, 1, 5, 'Processing artists');

    const newArtists = artists.filter(artist => {
      const key = this.getArtistKey(artist);
      return !this.entityMapping.artists.has(key);
    });

    this.logger.info({ 
      totalArtists: artists.length, 
      newArtists: newArtists.length, 
      duplicates: artists.length - newArtists.length 
    }, 'Artist processing stats');

    result.duplicatesSkipped += artists.length - newArtists.length;

    if (newArtists.length > 0) {
      const batches = this.createBatches(newArtists, this.config.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        try {
          this.logger.debug({ batchSize: batch.length, batchIndex: i }, 'Creating artist batch');
          const createdArtists = await this.prisma.artist.createManyAndReturn({
            data: batch,
          });

          this.logger.info({ createdCount: createdArtists.length }, 'Artists created successfully');

          // 更新映射
          for (const artist of createdArtists) {
            const key = this.getArtistKeyFromDb(artist);
            this.entityMapping.artists.set(key, artist.id);
            this.logger.debug({ artistName: artist.name, artistKey: key, artistId: artist.id }, 'Artist mapping added');
          }

          result.artistsCreated += createdArtists.length;
          this.reportProgress('artists', (i + 1) * this.config.batchSize, artists.length, 1, 5, `Created ${result.artistsCreated} artists`);
        } catch (error) {
          this.logger.error({ error, batchSize: batch.length }, 'Artist batch creation failed');
          await this.handleBatchError('artist', batch, error, result);
        }
      }
    }

    this.logger.info({ 
      finalArtistMappings: this.entityMapping.artists.size,
      artistsCreated: result.artistsCreated 
    }, 'Artist processing completed');
  }

  /**
   * 处理作品数据
   */
  private async processArtworks(result: BatchResult): Promise<void> {
    if (this.batchData.artworks.length === 0) {
      this.logger.info('No artworks to process');
      return;
    }

    this.logger.info({ 
      artworkCount: this.batchData.artworks.length,
      availableArtistMappings: this.entityMapping.artists.size,
      artistKeys: Array.from(this.entityMapping.artists.keys())
    }, 'Processing artworks');
    this.reportProgress('artworks', 0, this.batchData.artworks.length, 2, 5, 'Processing artworks');

    // 解析艺术家ID
    const artworksWithIds = this.batchData.artworks.map(artwork => {
      // 需要使用与添加艺术家时相同的解析逻辑
      const artistName = artwork.artistName!;
      
      // 尝试多种可能的键格式
      let artistId: number | undefined;
      
      // 1. 尝试原始名称
      artistId = this.entityMapping.artists.get(artistName);
      
      // 2. 如果没找到，尝试解析后的名称格式
      if (!artistId) {
        // 解析艺术家名称，获取displayName
        const parsed = this.parseArtistName(artistName);
        const displayNameKey = this.getArtistKey({
          name: parsed.displayName,
          username: parsed.username,
          userId: parsed.userId
        });
        artistId = this.entityMapping.artists.get(displayNameKey);
      }
      
      // 3. 如果还是没找到，尝试模糊匹配
      if (!artistId) {
        const parsed = this.parseArtistName(artistName);
        const searchName = parsed.displayName;
        
        for (const [key, id] of this.entityMapping.artists.entries()) {
          // 尝试精确匹配
          if (key === searchName) {
            artistId = id;
            break;
          }
          // 尝试包含匹配
          if (key.includes(searchName) || searchName.includes(key.split(':')[0])) {
            artistId = id;
            break;
          }
        }
      }
      
      if (!artistId) {
        this.logger.error({ 
          artistName, 
          availableKeys: Array.from(this.entityMapping.artists.keys()),
          artworkTitle: artwork.title 
        }, `Artist not found for artwork`);
        throw new Error(`Artist not found: ${artistName}`);
      }

      return {
        title: artwork.title,
        description: artwork.description,
        artistId,
        tempId: artwork.tempId,
        directoryCreatedAt: artwork.directoryCreatedAt,
        imageCount: artwork.imageCount,
        descriptionLength: artwork.descriptionLength,
        // 保留所有元数据字段
        externalId: artwork.externalId,
        sourceUrl: artwork.sourceUrl,
        originalUrl: artwork.originalUrl,
        thumbnailUrl: artwork.thumbnailUrl,
        xRestrict: artwork.xRestrict,
        isAiGenerated: artwork.isAiGenerated,
        size: artwork.size,
        bookmarkCount: artwork.bookmarkCount,
        sourceDate: artwork.sourceDate
      };
    });

    const batches = this.createBatches(artworksWithIds, this.config.batchSize);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        // 使用 upsert 方式处理每个作品，避免唯一约束冲突
        for (const item of batch) {
          const { tempId, ...artworkData } = item;
          
          const artwork = await this.prisma.artwork.upsert({
             where: {
               unique_artist_title: {
                 artistId: artworkData.artistId,
                 title: artworkData.title
               }
             },
             update: {
               description: artworkData.description,
               directoryCreatedAt: artworkData.directoryCreatedAt,
               imageCount: artworkData.imageCount,
               descriptionLength: artworkData.descriptionLength,
               // 更新所有元数据字段
               externalId: artworkData.externalId,
               sourceUrl: artworkData.sourceUrl,
               originalUrl: artworkData.originalUrl,
               thumbnailUrl: artworkData.thumbnailUrl,
               xRestrict: artworkData.xRestrict,
               isAiGenerated: artworkData.isAiGenerated,
               size: artworkData.size,
               bookmarkCount: artworkData.bookmarkCount,
               sourceDate: artworkData.sourceDate
             },
             create: artworkData
           });
          
          this.entityMapping.artworks.set(tempId, artwork.id);
          
          // 只有在创建新作品时才增加计数
          // 注意：upsert 不会告诉我们是创建还是更新，所以我们需要检查
          const wasCreated = await this.prisma.artwork.findFirst({
            where: { id: artwork.id },
            select: { createdAt: true, updatedAt: true }
          });
          
          if (wasCreated && wasCreated.createdAt.getTime() === wasCreated.updatedAt.getTime()) {
            result.artworksCreated++;
          }
        }
        
        this.reportProgress('artworks', (i + 1) * this.config.batchSize, this.batchData.artworks.length, 2, 5, `Processed ${result.artworksCreated} artworks`);
      } catch (error) {
        await this.handleBatchError('artwork', batch, error, result);
      }
    }
  }

  /**
   * 处理标签数据
   */
  private async processTags(result: BatchResult): Promise<void> {
    const tags = Array.from(this.batchData.tags.values());
    if (tags.length === 0) return;

    this.reportProgress('tags', 0, tags.length, 3, 5, 'Processing tags');

    const newTags = tags.filter(tag => !this.entityMapping.tags.has(tag.name));
    result.duplicatesSkipped += tags.length - newTags.length;

    if (newTags.length > 0) {
      const batches = this.createBatches(newTags, this.config.batchSize);
      
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        try {
          const createdTags = await this.prisma.tag.createManyAndReturn({
            data: batch,
          });

          // 更新映射
          for (const tag of createdTags) {
            this.entityMapping.tags.set(tag.name, tag.id);
          }

          result.tagsCreated += createdTags.length;
          this.reportProgress('tags', (i + 1) * this.config.batchSize, tags.length, 3, 5, `Created ${result.tagsCreated} tags`);
        } catch (error) {
          await this.handleBatchError('tag', batch, error, result);
        }
      }
    }
  }

  /**
   * 处理图片数据
   */
  private async processImages(result: BatchResult): Promise<void> {
    if (this.batchData.images.length === 0) return;

    this.reportProgress('images', 0, this.batchData.images.length, 4, 5, 'Processing images');

    // 解析作品ID
    const imagesWithIds = this.batchData.images.map(image => {
      const artworkId = this.entityMapping.artworks.get(image.tempArtworkId);
      
      if (!artworkId) {
        throw new Error(`Artwork not found for image: ${image.path}`);
      }

      return {
        path: image.path,
        size: image.size,
        sortOrder: image.sortOrder || 0,
        artworkId,
      };
    });

    // 批次内去重（按 artworkId + path）避免重复插入
    const seen = new Set<string>();
    const dedupedImages = imagesWithIds.filter(img => {
      const key = `${img.artworkId}::${img.path}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    const batches = this.createBatches(dedupedImages, this.config.batchSize);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const createRes = await this.prisma.image.createMany({
          data: batch,
          skipDuplicates: true,
        });

        result.imagesCreated += createRes.count;
        this.reportProgress('images', (i + 1) * this.config.batchSize, this.batchData.images.length, 4, 5, `Created ${result.imagesCreated} images`);
      } catch (error) {
        await this.handleBatchError('image', batch, error, result);
      }
    }
  }

  /**
   * 处理作品-标签关联
   */
  private async processArtworkTags(result: BatchResult): Promise<void> {
    if (this.batchData.artworkTags.length === 0) return;

    this.reportProgress('relations', 0, this.batchData.artworkTags.length, 5, 5, 'Processing artwork-tag relations');

    // 解析ID
    const artworkTagsWithIds = this.batchData.artworkTags.map(relation => {
      const artworkId = this.entityMapping.artworks.get(relation.tempArtworkId);
      const tagId = this.entityMapping.tags.get(relation.tagName);
      
      if (!artworkId) {
        throw new Error(`Artwork not found for relation: ${relation.tempArtworkId}`);
      }
      if (!tagId) {
        throw new Error(`Tag not found for relation: ${relation.tagName}`);
      }

      return { artworkId, tagId };
    });

    const batches = this.createBatches(artworkTagsWithIds, this.config.batchSize);
    
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const createRes = await this.prisma.artworkTag.createMany({
          data: batch,
          skipDuplicates: true,
        });

        result.artworkTagsCreated += createRes.count;
        this.reportProgress('relations', (i + 1) * this.config.batchSize, this.batchData.artworkTags.length, 5, 5, `Created ${result.artworkTagsCreated} relations`);
      } catch (error) {
        await this.handleBatchError('artworkTag', batch, error, result);
      }
    }
  }

  /**
   * 处理批量操作错误
   */
  private async handleBatchError(
    type: string,
    batch: any[],
    error: any,
    result: BatchResult
  ): Promise<void> {
    this.logger.error({ error, batchSize: batch.length, type }, `Batch ${type} operation failed`);
    
    // 尝试逐个处理
    for (const item of batch) {
      try {
        await this.processSingleItem(type, item, result);
      } catch (singleError) {
        result.errors.push({
          type: type as any,
          data: item,
          error: singleError instanceof Error ? singleError.message : 'Unknown error',
        });
      }
    }
  }

  /**
   * 处理单个项目
   */
  private async processSingleItem(type: string, item: any, result: BatchResult): Promise<void> {
    switch (type) {
      case 'artist':
        try {
          const artist = await this.prisma.artist.create({ data: item });
          const key = this.getArtistKeyFromDb(artist);
          this.entityMapping.artists.set(key, artist.id);
          result.artistsCreated++;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            // 唯一约束冲突，查找已存在的艺术家
            let existingArtist = null as null | { id: number; name: string; username: string | null; userId: string | null };
            if (item.username && item.userId) {
              existingArtist = await this.prisma.artist.findUnique({
                where: {
                  unique_username_userid: {
                    username: item.username,
                    userId: item.userId,
                  },
                },
                select: { id: true, name: true, username: true, userId: true },
              });
            } else if (item.name) {
              existingArtist = await this.prisma.artist.findFirst({
                where: { name: item.name },
                select: { id: true, name: true, username: true, userId: true },
              });
            }
            if (existingArtist) {
              const key = this.getArtistKeyFromDb(existingArtist);
              this.entityMapping.artists.set(key, existingArtist.id);
              // 不增加 artistsCreated 计数，因为是已存在的
            } else {
              throw e;
            }
          } else {
            throw e;
          }
        }
        break;
      case 'artwork':
        const { tempId, ...artworkData } = item;
        try {
          const artwork = await this.prisma.artwork.create({ data: artworkData });
          this.entityMapping.artworks.set(tempId, artwork.id);
          result.artworksCreated++;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            // 唯一约束冲突，查找已存在的作品
            const existingArtwork = await this.prisma.artwork.findFirst({
              where: { 
                title: artworkData.title, 
                artistId: artworkData.artistId 
              }
            });
            if (existingArtwork) {
              this.entityMapping.artworks.set(tempId, existingArtwork.id);
              // 不增加 artworksCreated 计数，因为是已存在的
            } else {
              throw e; // 如果找不到已存在的作品，重新抛出错误
            }
          } else {
            throw e;
          }
        }
        break;
      case 'tag':
        try {
          const tag = await this.prisma.tag.create({ data: item });
          this.entityMapping.tags.set(tag.name, tag.id);
          result.tagsCreated++;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            const existingTag = await this.prisma.tag.findUnique({ where: { name: item.name } });
            if (existingTag) {
              this.entityMapping.tags.set(existingTag.name, existingTag.id);
              // 不增加 tagsCreated 计数，因为是已存在的
            } else {
              throw e;
            }
          } else {
            throw e;
          }
        }
        break;
      case 'image':
        try {
          await this.prisma.image.create({ data: item });
          result.imagesCreated++;
        } catch (e) {
          if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            // 基于唯一约束跳过重复图片
            // 不增加 imagesCreated
          } else {
            throw e;
          }
        }
        break;
      case 'artworkTag':
        await this.prisma.artworkTag.create({ data: item });
        result.artworkTagsCreated++;
        break;
    }
  }

  /**
   * 创建批次
   */
  private createBatches<T>(items: T[], batchSize: number): T[][] {
    const batches: T[][] = [];
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize));
    }
    return batches;
  }

  /**
   * 生成临时ID
   */
  private generateTempId(type: string, ...parts: string[]): string {
    return `${type}:${parts.join(':')}`;
  }

  /**
   * 获取艺术家键
   */
  private getArtistKey(artist: ArtistData): string {
    if (artist.username && artist.userId) {
      return `${artist.username}:${artist.userId}`;
    }
    return artist.name;
  }

  /**
   * 从数据库记录获取艺术家键
   */
  private getArtistKeyFromDb(artist: { name: string; username?: string | null; userId?: string | null }): string {
    if (artist.username && artist.userId) {
      return `${artist.username}:${artist.userId}`;
    }
    return artist.name;
  }

  /**
   * 解析艺术家名称（与CacheManager保持一致）
   */
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

    // 处理包含斜杠的格式，如 "用户名/其他信息"
    match = artistName.match(/^([^/]+)\/(.*)$/);
    if (match) {
      const username = match[1].trim();
      if (username.length > 0) {
        return {
          displayName: username,
          username: username,
          userId: null,
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

  /**
   * 报告进度
   */
  private reportProgress(
    phase: BatchProgress['phase'],
    current: number,
    total: number,
    currentBatch: number,
    totalBatches: number,
    itemType: string
  ): void {
    if (this.config.enableProgressCallback && this.onProgress) {
      this.onProgress({
        phase,
        current: Math.min(current, total),
        total,
        percentage: total > 0 ? Math.floor((Math.min(current, total) / total) * 100) : 0,
        currentBatch,
        totalBatches,
        itemType,
      });
    }
  }

  /**
   * 获取当前批量数据统计
   */
  getStats() {
    return {
      artists: this.batchData.artists.size,
      artworks: this.batchData.artworks.length,
      images: this.batchData.images.length,
      tags: this.batchData.tags.size,
      artworkTags: this.batchData.artworkTags.length,
      totalItems: this.batchData.artists.size + 
                  this.batchData.artworks.length + 
                  this.batchData.images.length + 
                  this.batchData.tags.size + 
                  this.batchData.artworkTags.length,
    };
  }

  /**
   * 检查是否应该刷新
   */
  shouldFlush(): boolean {
    const stats = this.getStats();
    const timeSinceLastFlush = Date.now() - this.lastFlushTime;
    const sizeThreshold = stats.totalItems >= this.config.batchSize;
    const timeThreshold = timeSinceLastFlush > 5000; // 5秒强制刷新
    
    return sizeThreshold || timeThreshold;
  }

  /**
   * 智能批处理刷新
   * 基于时间和大小的智能判断
   */
  async smartFlush(): Promise<BatchResult | null> {
    if (this.shouldFlush()) {
      const result = await this.flush();
      this.lastFlushTime = Date.now();
      return result;
    }
    return null;
  }

  /**
   * 启用流式模式
   */
  enableStreamMode(): void {
    this.streamMode = true;
    this.logger.debug('Stream mode enabled for batch processor');
  }

  /**
   * 添加到流式批处理
   * 在流式模式下自动管理批处理
   */
  async addToStreamBatch(data: {
    artist?: ArtistData;
    artwork?: ArtworkData & { artistName: string };
    images?: Array<ImageData & { artworkTitle: string; artistName: string }>;
    tags?: TagData[];
  }): Promise<BatchResult | null> {
    // 添加数据到批处理
    if (data.artist) {
      this.addArtist(data.artist);
    }
    
    if (data.artwork) {
      this.addArtwork(data.artwork);
    }
    
    if (data.images) {
      data.images.forEach(image => this.addImage(image));
    }
    
    if (data.tags) {
      data.tags.forEach(tag => this.addTag(tag));
    }
    
    // 在流式模式下自动检查是否需要刷新
    if (this.streamMode) {
      return await this.smartFlush();
    }
    
    return null;
  }

  /**
   * 优化的批处理提交
   * 包含性能优化和错误恢复
   */
  async optimizedFlush(): Promise<BatchResult> {
    const startTime = Date.now();
    
    try {
      // 检查是否有数据需要处理
      const stats = this.getStats();
      if (stats.totalItems === 0) {
        return {
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
      
      this.logger.debug({ stats }, 'Starting optimized batch flush');
      
      // 执行标准刷新
      const result = await this.flush();
      
      // 更新最后刷新时间
      this.lastFlushTime = Date.now();
      
      this.logger.debug({
        result,
        processingTime: Date.now() - startTime
      }, 'Optimized batch flush completed');
      
      return result;
      
    } catch (error) {
      this.logger.error({ error }, 'Optimized batch flush failed');
      throw error;
    }
  }

  /**
   * 清空批量数据
   */
  clear(): void {
    this.initializeBatchData();
  }
}