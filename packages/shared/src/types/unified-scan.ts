/**
 * 统一扫描器相关类型定义
 * 支持元数据扫描和媒体文件扫描的一体化处理
 */

import { ArtworkMetadata, MediaFile } from './metadata'

// ============================================================================
// 统一扫描选项
// ============================================================================

/**
 * 统一扫描选项
 */
export interface UnifiedScanOptions {
  /** 最大并发数 */
  maxConcurrency?: number
  /** 批处理大小 */
  batchSize?: number
  /** 流缓冲区大小 */
  streamBufferSize?: number
  /** 内存阈值 (字节) */
  memoryThreshold?: number
}

/**
 * 处理选项
 */
export interface ProcessOptions {
  /** 进度回调 */
  onProgress?: (progress: ProcessProgress) => void
  /** 错误回调 */
  onError?: (error: Error) => void
  /** 批处理大小 */
  batchSize?: number
  /** 最大并发数 */
  maxConcurrency?: number
}

// ============================================================================
// 进度和结果类型
// ============================================================================

/**
 * 处理进度
 */
export interface ProcessProgress {
  /** 已处理数量 */
  processed: number
  /** 总数量 */
  total: number
  /** 当前处理的作品结果 */
  current?: ArtworkProcessResult
}

/**
 * 处理结果
 */
export interface ProcessResult {
  /** 总文件数 */
  totalFiles: number
  /** 已处理文件数 */
  processedFiles: number
  /** 成功文件数 */
  successfulFiles: number
  /** 失败文件数 */
  failedFiles: number
  /** 错误列表 */
  errors: string[]
  /** 性能指标 */
  performance: PerformanceMetrics
  /** 新增作品数 */
  newArtworks: number
  /** 新增图片数 */
  newImages: number
  /** 元数据文件数 */
  metadataFiles: number
  /** 已处理元数据数 */
  processedMetadata: number
  /** 跳过的元数据 */
  skippedMetadata: string[]
}

// ============================================================================
// 作品处理相关类型
// ============================================================================

/**
 * 作品处理结果
 */
export interface ArtworkProcessResult {
  /** 元数据文件路径 */
  metadataFile: string
  /** 处理是否成功 */
  success: boolean
  /** 错误列表 */
  errors: string[]
  /** 解析的元数据 */
  metadata?: ArtworkMetadata
  /** 路径信息 */
  pathInfo?: PathInfo
  /** 关联的媒体文件 */
  mediaFiles?: MediaFile[]
  /** 艺术家数据 */
  artist?: ArtistData
  /** 作品数据 */
  artwork?: ArtworkData
  /** 图片数据 */
  images?: ImageData[]
  /** 标签数据 */
  tags?: TagData[]
}

// ArtworkMetadata 从 metadata.ts 导入

/**
 * 路径信息
 */
export interface PathInfo {
  /** 艺术家目录名 */
  artistDir: string
  /** 作品目录名 */
  artworkDir: string
  /** 完整路径 */
  fullPath: string
  /** 相对路径 */
  relativePath: string
}

// MediaFile 从 metadata.ts 导入

// ============================================================================
// 数据库实体类型
// ============================================================================

/**
 * 艺术家数据
 */
export interface ArtistData {
  /** 艺术家名称 */
  name: string
  /** 用户名 */
  username: string
  /** 用户ID */
  userId: string
  /** 头像URL */
  avatarUrl?: string
  /** 个人简介 */
  bio?: string
  /** 社交链接 */
  socialLinks?: Record<string, string>
}

/**
 * 作品数据
 */
export interface ArtworkData {
  /** 标题 */
  title: string
  /** 描述 */
  description?: string
  /** 外部ID */
  externalId: string
  /** 来源URL */
  sourceUrl?: string
  /** 原图URL */
  originalUrl?: string
  /** 缩略图URL */
  thumbnailUrl?: string
  /** 限制等级 */
  xRestrict?: string
  /** 是否AI生成 */
  isAiGenerated?: boolean
  /** 尺寸信息 */
  size?: string
  /** 收藏数 */
  bookmarkCount?: number
  /** 发布日期 */
  sourceDate?: Date
  /** 图片数量 */
  imageCount: number
  /** 艺术家ID */
  artistId?: number
  /** 创建时间 */
  createdAt?: Date
  /** 更新时间 */
  updatedAt?: Date
}

/**
 * 图片数据
 */
export interface ImageData {
  /** 文件路径 */
  path: string
  /** 文件名 */
  filename: string
  /** 文件扩展名 */
  extension: string
  /** 文件大小 */
  size: number
  /** 页码 */
  pageNumber: number
  /** 是否为主图 */
  isPrimary: boolean
  /** 作品ID */
  artworkId?: number
  /** 创建时间 */
  createdAt?: Date
}

/**
 * 标签数据
 */
export interface TagData {
  /** 标签名称 */
  name: string
  /** 标签类型 */
  type?: string
  /** 使用次数 */
  count?: number
}

// ============================================================================
// 流控制相关类型
// ============================================================================

/**
 * 流控制选项
 */
export interface StreamControlOptions {
  /** 最大内存使用量 (字节) */
  maxMemoryUsage: number
  /** 批处理刷新阈值 */
  batchFlushThreshold: number
  /** 并发调整因子 */
  concurrencyAdjustmentFactor: number
  /** 内存检查间隔 (毫秒) */
  memoryCheckInterval: number
  /** 性能采样间隔 (毫秒) */
  performanceSampleInterval: number
}

/**
 * 处理队列
 */
export interface ProcessingQueue {
  /** 文件列表 */
  files: string[]
  /** 当前索引 */
  currentIndex: number
  /** 总数量 */
  totalCount: number
  /** 是否完成 */
  isCompleted: boolean
}

// ============================================================================
// 验证和错误处理类型
// ============================================================================

/**
 * 扩展验证结果（包含警告）
 */
export interface ExtendedValidationResult {
  /** 是否有效 */
  isValid: boolean
  /** 错误列表 */
  errors: string[]
  /** 警告列表 */
  warnings: string[]
}

/**
 * 处理上下文
 */
export interface ProcessContext {
  /** 当前文件 */
  currentFile: string
  /** 处理阶段 */
  stage: ProcessingStage
  /** 开始时间 */
  startTime: number
  /** 重试次数 */
  retryCount: number
  /** 上下文数据 */
  data: Record<string, any>
}

/**
 * 处理阶段枚举
 */
export enum ProcessingStage {
  DISCOVERY = 'discovery',
  METADATA_PARSING = 'metadata_parsing',
  MEDIA_ASSOCIATION = 'media_association',
  DATA_GENERATION = 'data_generation',
  VALIDATION = 'validation',
  BATCH_PROCESSING = 'batch_processing',
  COMPLETED = 'completed',
  FAILED = 'failed'
}

// ============================================================================
// 性能监控类型
// ============================================================================

/**
 * 性能指标
 */
export interface PerformanceMetrics {
  /** 持续时间 (毫秒) */
  duration: number
  /** 吞吐量 (文件/秒) */
  throughput: number
  /** 内存使用情况 */
  memoryUsage: MemoryUsage
  /** 并发统计 */
  concurrencyStats: ConcurrencyStats
  /** 批处理统计 */
  batchStats: BatchStats
  /** 错误统计 */
  errorStats: ErrorStats
}

/**
 * 内存使用情况
 */
export interface MemoryUsage {
  /** 堆内存使用 (字节) */
  heapUsed: number
  /** 堆内存总量 (字节) */
  heapTotal: number
  /** 外部内存 (字节) */
  external: number
  /** 常驻内存 (字节) */
  rss: number
  /** 峰值内存使用 (字节) */
  peakUsage: number
}

/**
 * 并发统计
 */
export interface ConcurrencyStats {
  /** 最大并发数 */
  maxConcurrency: number
  /** 平均并发数 */
  avgConcurrency: number
  /** 当前并发数 */
  currentConcurrency: number
  /** 峰值队列长度 */
  peakQueueLength: number
  /** 当前队列长度 */
  currentQueueLength: number
  /** 并发效率 */
  efficiency: number
}

/**
 * 批处理统计
 */
export interface BatchStats {
  /** 总批次数 */
  totalBatches: number
  /** 平均批次大小 */
  avgBatchSize: number
  /** 批处理总时间 (毫秒) */
  totalBatchTime: number
  /** 平均批处理时间 (毫秒) */
  avgBatchTime: number
  /** 批处理效率 */
  batchEfficiency: number
}

/**
 * 错误统计
 */
export interface ErrorStats {
  /** 总错误数 */
  totalErrors: number
  /** 错误率 */
  errorRate: number
  /** 按类型分组的错误 */
  errorsByType: Record<string, number>
  /** 按阶段分组的错误 */
  errorsByStage: Record<ProcessingStage, number>
}

// ============================================================================
// 监控和报告类型
// ============================================================================

/**
 * 监控报告
 */
export interface MonitoringReport {
  /** 总处理时间 (毫秒) */
  totalProcessingTime: number
  /** 平均作品处理时间 (毫秒) */
  averageArtworkTime: number
  /** 内存峰值 (字节) */
  memoryPeak: number
  /** 并发效率 */
  concurrencyEfficiency: number
  /** 批处理效率 */
  batchEfficiency: number
  /** 错误率 */
  errorRate: number
  /** 吞吐量 (作品/秒) */
  throughput: number
}

/**
 * 处理摘要
 */
export interface ProcessSummary {
  /** 总处理数 */
  totalProcessed: number
  /** 成功数 */
  successful: number
  /** 失败数 */
  failed: number
  /** 失败率 */
  failureRate: number
  /** 是否应该继续 */
  shouldContinue: boolean
  /** 处理时间 (毫秒) */
  processingTime: number
  /** 平均处理时间 (毫秒) */
  averageTime: number
}

// ============================================================================
// 策略推荐类型
// ============================================================================

/**
 * 策略推荐
 */
export interface StrategyRecommendation {
  /** 推荐的策略 */
  recommended: string
  /** 推荐理由 */
  reason: string
  /** 备选策略 */
  alternatives: Array<{
    strategy: string
    reason: string
    score: number
  }>
  /** 推荐置信度 */
  confidence: number
}

/**
 * 策略可用性
 */
export interface StrategyAvailability {
  /** 策略名称 */
  strategy: string
  /** 是否可用 */
  available: boolean
  /** 问题列表 */
  issues: string[]
  /** 预估持续时间 (毫秒) */
  estimatedDuration: number
  /** 适用性评分 */
  suitabilityScore: number
}

// ============================================================================
// 导出所有类型
// ============================================================================

// 所有类型已在上方定义并导出
