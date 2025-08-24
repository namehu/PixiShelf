// ============================================================================
// 扫描器重构 - 元数据相关类型定义
// ============================================================================

import { ScanProgress } from './scan'

/**
 * 扫描策略类型
 */
export type ScanStrategyType = 'legacy' | 'unified'

/**
 * 扩展的扫描选项
 */
export interface ExtendedScanOptions {
  scanPath: string
  scanType?: ScanStrategyType // 新增：扫描类型
  forceUpdate?: boolean
  supportedExtensions?: string[]
  onProgress?: (progress: ScanProgress) => void
}

/**
 * 扩展的扫描结果
 */
export interface ExtendedScanResult {
  scannedDirectories: number
  foundImages: number
  newArtworks: number
  newImages: number
  removedArtworks?: number
  errors: string[]
  skippedDirectories?: Array<{ path: string; reason: string }>
  // 新增字段
  metadataFiles?: number
  processedMetadata?: number
  skippedMetadata?: Array<{ path: string; reason: string }>
}

/**
 * 作品元数据接口
 */
export interface ArtworkMetadata {
  id: string // 必填：作品ID
  title: string // 必填：作品标题
  user: string // 必填：用户名
  userId: string // 必填：用户ID
  description?: string // 可选：作品描述
  tags?: string[] // 可选：标签数组
  url?: string // 可选：作品URL
  originalUrl?: string // 可选：原始图片URL
  thumbnailUrl?: string // 可选：缩略图URL
  xRestrict?: string // 可选：限制等级
  ai?: boolean // 可选：是否AI生成
  size?: string // 可选：尺寸信息
  bookmark?: number // 可选：收藏数量
  date?: Date // 可选：发布日期
}

/**
 * 艺术家信息接口
 */
export interface ArtistInfo {
  name: string // 艺术家显示名称
  username?: string // 用户名
  userId?: string // 用户ID
}

/**
 * 作品信息接口
 */
export interface ArtworkInfo {
  title?: string // 作品标题
  relativePath: string // 相对路径
}

/**
 * 媒体文件接口
 */
export interface MediaFile {
  path: string // 文件完整路径
  name: string // 文件名
  extension: string // 文件扩展名
  size: number // 文件大小
  artworkId: string // 关联的作品ID
  pageNumber?: number // 页码（从文件名解析）
}

/**
 * 验证结果接口
 */
export interface ValidationResult {
  isValid: boolean // 是否有效
  errors: string[] // 错误信息列表
}

/**
 * 元数据解析器接口
 */
export interface IMetadataParser {
  /**
   * 解析元数据文件
   * @param filePath 文件路径
   * @returns 解析后的元数据
   */
  parse(filePath: string): Promise<ArtworkMetadata>

  /**
   * 验证元数据
   * @param metadata 元数据对象
   * @returns 验证结果
   */
  validate(metadata: ArtworkMetadata): ValidationResult

  /**
   * 获取必填字段列表
   * @returns 必填字段名称数组
   */
  getRequiredFields(): string[]
}

/**
 * 路径解析器接口
 */
export interface IPathParser {
  /**
   * 从目录路径解析艺术家信息
   * @param dirPath 目录路径
   * @returns 艺术家信息
   */
  parseArtistInfo(dirPath: string): ArtistInfo

  /**
   * 从目录路径解析作品信息
   * @param dirPath 目录路径
   * @returns 作品信息
   */
  parseArtworkInfo(dirPath: string): ArtworkInfo

  /**
   * 计算相对路径
   * @param fullPath 完整路径
   * @param basePath 基础路径
   * @returns 相对路径
   */
  getRelativePath(fullPath: string, basePath: string): string
}

/**
 * 文件关联器接口
 */
export interface IFileAssociator {
  /**
   * 查找与元数据文件关联的媒体文件
   * @param metadataPath 元数据文件路径
   * @param artworkId 作品ID
   * @returns 媒体文件列表
   */
  findMediaFiles(metadataPath: string, artworkId: string): Promise<MediaFile[]>

  /**
   * 验证文件关联关系
   * @param metadataFile 元数据文件路径
   * @param mediaFiles 媒体文件列表
   * @returns 是否关联有效
   */
  validateAssociation(metadataFile: string, mediaFiles: MediaFile[]): boolean
}

/**
 * 扫描策略接口
 */
export interface IScanStrategy {
  readonly name: string // 策略名称
  readonly description: string // 策略描述

  /**
   * 执行扫描策略
   * @param options 扫描选项
   * @returns 扫描结果
   */
  execute(options: ExtendedScanOptions): Promise<ExtendedScanResult>

  /**
   * 验证扫描选项
   * @param options 扫描选项
   * @returns 验证结果
   */
  validate(options: ExtendedScanOptions): ValidationResult

  /**
   * 估算扫描时长
   * @param options 扫描选项
   * @returns 预估时长（毫秒）
   */
  getEstimatedDuration(options: ExtendedScanOptions): Promise<number>
}

/**
 * 扫描编排器接口
 */
export interface IScanOrchestrator {
  /**
   * 执行扫描
   * @param options 扫描选项
   * @returns 扫描结果
   */
  scan(options: ExtendedScanOptions): Promise<ExtendedScanResult>

  /**
   * 设置扫描策略
   * @param strategy 策略类型
   */
  setStrategy(strategy: ScanStrategyType): void
}

/**
 * 扫描编排器配置选项
 */
export interface ScanOrchestratorOptions {
  enableOptimizations?: boolean // 是否启用性能优化
  maxConcurrency?: number // 最大并发数
  defaultStrategy?: ScanStrategyType // 默认策略
  metadataFilePattern?: string // 元数据文件匹配模式
  enableMetadataCache?: boolean // 是否启用元数据缓存
  enableFileAssociationCache?: boolean // 是否启用文件关联缓存
}

/**
 * 元数据验证错误
 */
export class MetadataValidationError extends Error {
  constructor(public errors: string[]) {
    super(`Metadata validation failed: ${errors.join(', ')}`)
    this.name = 'MetadataValidationError'
  }
}

/**
 * 元数据解析错误
 */
export class MetadataParseError extends Error {
  public cause?: Error

  constructor(
    public filePath: string,
    cause: Error
  ) {
    super(`Failed to parse metadata file: ${filePath}`)
    this.name = 'MetadataParseError'
    this.cause = cause
  }
}

/**
 * 文件关联错误
 */
export class FileAssociationError extends Error {
  constructor(
    public metadataPath: string,
    public artworkId: string
  ) {
    super(`No media files found for artwork: ${artworkId}`)
    this.name = 'FileAssociationError'
  }
}

/**
 * 不支持的策略错误
 */
export class UnsupportedStrategyError extends Error {
  constructor(public strategyType: string) {
    super(`Unsupported scan strategy: ${strategyType}`)
    this.name = 'UnsupportedStrategyError'
  }
}

/**
 * 扩展的数据库字段映射
 */
export interface ExtendedArtworkData {
  // 现有字段
  title: string
  description?: string
  artistId: number
  directoryCreatedAt?: Date
  imageCount?: number
  descriptionLength?: number

  // 新增字段
  externalId?: string // 外部ID（如Pixiv ID）
  sourceUrl?: string // 作品来源URL
  originalUrl?: string // 原始图片URL
  thumbnailUrl?: string // 缩略图URL
  xRestrict?: string // 限制等级
  isAiGenerated?: boolean // 是否AI生成
  size?: string // 尺寸信息
  bookmarkCount?: number // 收藏数量
  sourceDate?: Date // 原始发布日期
}

/**
 * 批量处理数据接口
 */
export interface BatchData {
  artists: Array<{
    name: string
    username?: string
    userId?: string
    tempId: string
  }>
  artworks: Array<
    ExtendedArtworkData & {
      tempId: string
      artistTempId: string
    }
  >
  tags: Array<{
    name: string
  }>
  artworkTags: Array<{
    artworkTempId: string
    tagName: string
  }>
  images: Array<{
    path: string
    width?: number
    height?: number
    size?: number
    sortOrder: number
    artworkTempId: string
  }>
}
