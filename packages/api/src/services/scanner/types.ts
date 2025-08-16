/**
 * 扫描器相关的类型定义
 */

/**
 * 艺术家数据
 */
export interface ArtistData {
  name: string;
  username?: string | null;
  userId?: string | null;
  bio?: string | null;
}

/**
 * 作品数据
 */
export interface ArtworkData {
  title: string;
  description?: string | null;
  artistId: number;
  artistName?: string; // 用于批量处理时的关联
}

/**
 * 图片数据
 */
export interface ImageData {
  path: string;
  size: number;
  artworkId?: number;
  artworkTitle?: string; // 用于批量处理时的关联
  artistName?: string; // 用于批量处理时的关联
}

/**
 * 标签数据
 */
export interface TagData {
  name: string;
}

/**
 * 作品-标签关联数据
 */
export interface ArtworkTagData {
  artworkId: number;
  tagId: number;
  artworkTitle?: string; // 用于批量处理时的关联
  tagName?: string; // 用于批量处理时的关联
}

/**
 * 批量数据容器
 */
export interface BatchData {
  artists: Map<string, ArtistData>;
  artworks: Array<ArtworkData & { tempId: string }>;
  images: Array<ImageData & { tempArtworkId: string }>;
  tags: Map<string, TagData>;
  artworkTags: Array<{ tempArtworkId: string; tagName: string }>;
}

/**
 * 批量处理结果
 */
export interface BatchResult {
  artistsCreated: number;
  artistsUpdated: number;
  artworksCreated: number;
  artworksUpdated: number;
  imagesCreated: number;
  tagsCreated: number;
  artworkTagsCreated: number;
  errors: Array<{
    type: 'artist' | 'artwork' | 'image' | 'tag' | 'artworkTag';
    data: any;
    error: string;
  }>;
  duplicatesSkipped: number;
  processingTime: number;
}

/**
 * 批量处理配置
 */
export interface BatchConfig {
  batchSize: number;
  maxRetries: number;
  retryDelay: number;
  enableDeduplication: boolean;
  enableProgressCallback: boolean;
}

/**
 * 批量处理进度信息
 */
export interface BatchProgress {
  phase: 'preparing' | 'artists' | 'artworks' | 'images' | 'tags' | 'relations' | 'complete';
  current: number;
  total: number;
  percentage: number;
  currentBatch: number;
  totalBatches: number;
  itemType: string;
}

/**
 * 数据库实体映射
 */
export interface EntityMapping {
  artists: Map<string, number>; // name -> id
  artworks: Map<string, number>; // title -> id
  tags: Map<string, number>; // name -> id
}

/**
 * 扫描任务数据
 */
export interface ScanTask {
  type: 'artist' | 'artwork' | 'image';
  path: string;
  parentPath?: string;
  metadata?: any;
  priority?: number;
}

/**
 * 任务执行结果
 */
export interface TaskResult {
  success: boolean;
  data?: any;
  error?: string;
  skipped?: boolean;
  reason?: string;
  processingTime?: number;
}

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  startTime: number;
  endTime?: number;
  totalFiles: number;
  processedFiles: number;
  skippedFiles: number;
  errorFiles: number;
  throughput: number; // files per second
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  concurrencyStats: {
    maxConcurrent: number;
    avgConcurrent: number;
    peakQueueLength: number;
    currentQueueLength: number;
  };
  databaseStats: {
    totalQueries: number;
    batchOperations: number;
    avgBatchSize: number;
    totalInserts: number;
    totalUpdates: number;
  };
}

/**
 * 错误统计
 */
export interface ErrorStats {
  totalErrors: number;
  errorsByType: Map<string, number>;
  errorsByPhase: Map<string, number>;
  criticalErrors: number;
  recoverableErrors: number;
  errorRate: number;
}

/**
 * 缓存统计
 */
export interface CacheStats {
  hits: number;
  misses: number;
  hitRate: number;
  cacheSize: number;
  memoryUsage: number;
}