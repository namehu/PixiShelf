// ============================================================================
// 媒体工具函数
// ============================================================================

import { MediaType, getMediaType, getMediaMimeType, isVideoFile } from '../types/media'

/**
 * 媒体URL配置接口
 */
export interface MediaUrlConfig {
  /** API基础URL */
  baseUrl?: string
  /** 是否启用缓存参数 */
  enableCache?: boolean
  /** 自定义缓存参数 */
  cacheParam?: string
}

/**
 * 默认媒体URL配置
 */
const DEFAULT_MEDIA_CONFIG: Required<MediaUrlConfig> = {
  baseUrl: '/api/v1/images',
  enableCache: true,
  cacheParam: 'v'
}

/**
 * 生成媒体文件访问URL
 * @param filePath 文件路径
 * @param config URL配置选项
 * @returns 完整的媒体文件URL
 */
export function generateMediaUrl(filePath: string, config: MediaUrlConfig = {}): string {
  const finalConfig = { ...DEFAULT_MEDIA_CONFIG, ...config }
  
  // 确保文件路径正确编码
  const encodedPath = encodeURIComponent(filePath)
  
  // 构建基础URL
  let url = `${finalConfig.baseUrl}/${encodedPath}`
  
  // 添加缓存参数（用于缓存控制）
  if (finalConfig.enableCache) {
    const timestamp = Date.now()
    const separator = url.includes('?') ? '&' : '?'
    url += `${separator}${finalConfig.cacheParam}=${timestamp}`
  }
  
  return url
}

/**
 * 生成视频预览URL（用于poster属性）
 * @param filePath 视频文件路径
 * @param config URL配置选项
 * @returns 视频预览URL
 */
export function generateVideoPreviewUrl(filePath: string, config: MediaUrlConfig = {}): string {
  // 对于视频文件，我们使用相同的URL，浏览器会自动处理
  return generateMediaUrl(filePath, config)
}

/**
 * 媒体加载状态枚举
 */
export enum MediaLoadState {
  IDLE = 'idle',
  LOADING = 'loading',
  LOADED = 'loaded',
  ERROR = 'error'
}

/**
 * 媒体错误类型枚举
 */
export enum MediaErrorType {
  NETWORK_ERROR = 'network_error',
  FORMAT_ERROR = 'format_error',
  NOT_FOUND = 'not_found',
  PERMISSION_ERROR = 'permission_error',
  UNKNOWN_ERROR = 'unknown_error'
}

/**
 * 媒体错误信息接口
 */
export interface MediaError {
  type: MediaErrorType
  message: string
  originalError?: Error
}

/**
 * 媒体加载状态接口
 */
export interface MediaLoadStatus {
  state: MediaLoadState
  progress?: number
  error?: MediaError
}

/**
 * 创建媒体错误对象
 * @param type 错误类型
 * @param message 错误消息
 * @param originalError 原始错误对象
 * @returns 媒体错误对象
 */
export function createMediaError(
  type: MediaErrorType,
  message: string,
  originalError?: Error
): MediaError {
  return {
    type,
    message,
    ...(originalError && { originalError })
  }
}

/**
 * 从HTML媒体元素错误代码获取错误类型
 * @param errorCode HTML媒体元素错误代码
 * @returns 媒体错误类型
 */
export function getMediaErrorTypeFromCode(errorCode: number): MediaErrorType {
  switch (errorCode) {
    case 1: // MEDIA_ERR_ABORTED
      return MediaErrorType.NETWORK_ERROR
    case 2: // MEDIA_ERR_NETWORK
      return MediaErrorType.NETWORK_ERROR
    case 3: // MEDIA_ERR_DECODE
      return MediaErrorType.FORMAT_ERROR
    case 4: // MEDIA_ERR_SRC_NOT_SUPPORTED
      return MediaErrorType.FORMAT_ERROR
    default:
      return MediaErrorType.UNKNOWN_ERROR
  }
}

/**
 * 获取友好的错误消息
 * @param error 媒体错误对象
 * @returns 用户友好的错误消息
 */
export function getFriendlyErrorMessage(error: MediaError): string {
  switch (error.type) {
    case MediaErrorType.NETWORK_ERROR:
      return '网络连接错误，请检查网络连接后重试'
    case MediaErrorType.FORMAT_ERROR:
      return '媒体格式不支持或文件已损坏'
    case MediaErrorType.NOT_FOUND:
      return '找不到指定的媒体文件'
    case MediaErrorType.PERMISSION_ERROR:
      return '没有权限访问该媒体文件'
    case MediaErrorType.UNKNOWN_ERROR:
    default:
      return '加载媒体文件时发生未知错误'
  }
}

/**
 * 媒体缓存管理器
 */
export class MediaCacheManager {
  private cache = new Map<string, string>()
  private maxCacheSize: number
  
  constructor(maxCacheSize = 100) {
    this.maxCacheSize = maxCacheSize
  }
  
  /**
   * 获取缓存的媒体URL
   * @param filePath 文件路径
   * @returns 缓存的URL或undefined
   */
  get(filePath: string): string | undefined {
    return this.cache.get(filePath)
  }
  
  /**
   * 设置媒体URL缓存
   * @param filePath 文件路径
   * @param url 媒体URL
   */
  set(filePath: string, url: string): void {
    // 如果缓存已满，删除最旧的条目
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value
      if (firstKey) {
        this.cache.delete(firstKey)
      }
    }
    
    this.cache.set(filePath, url)
  }
  
  /**
   * 删除缓存条目
   * @param filePath 文件路径
   */
  delete(filePath: string): void {
    this.cache.delete(filePath)
  }
  
  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear()
  }
  
  /**
   * 获取缓存大小
   * @returns 当前缓存条目数量
   */
  size(): number {
    return this.cache.size
  }
}

/**
 * 全局媒体缓存管理器实例
 */
export const globalMediaCache = new MediaCacheManager()

/**
 * 获取带缓存的媒体URL
 * @param filePath 文件路径
 * @param config URL配置选项
 * @returns 媒体URL
 */
export function getCachedMediaUrl(filePath: string, config: MediaUrlConfig = {}): string {
  const cacheKey = `${filePath}_${JSON.stringify(config)}`
  
  // 尝试从缓存获取
  const cachedUrl = globalMediaCache.get(cacheKey)
  if (cachedUrl) {
    return cachedUrl
  }
  
  // 生成新URL并缓存
  const url = generateMediaUrl(filePath, config)
  globalMediaCache.set(cacheKey, url)
  
  return url
}

/**
 * 预加载媒体文件（仅在浏览器环境中可用）
 * @param filePath 文件路径
 * @param config URL配置选项
 * @returns Promise，解析为加载状态
 */
export function preloadMedia(filePath: string, config: MediaUrlConfig = {}): Promise<MediaLoadStatus> {
  return new Promise((resolve) => {
    // 检查是否在浏览器环境中
    if (typeof window === 'undefined') {
      const error = createMediaError(
        MediaErrorType.UNKNOWN_ERROR,
        '预加载功能仅在浏览器环境中可用'
      )
      resolve({ state: MediaLoadState.ERROR, error })
      return
    }
    
    const url = generateMediaUrl(filePath, config)
    const mediaType = getMediaType(filePath)
    
    if (mediaType === MediaType.IMAGE) {
      // 预加载图片
      const img = new (window as any).Image()
      
      img.onload = () => {
        resolve({ state: MediaLoadState.LOADED })
      }
      
      img.onerror = (event: any) => {
        const error = createMediaError(
          MediaErrorType.NETWORK_ERROR,
          '图片加载失败',
          event.error
        )
        resolve({ state: MediaLoadState.ERROR, error })
      }
      
      img.src = url
    } else if (mediaType === MediaType.VIDEO) {
      // 预加载视频元数据
      const video = (window as any).document.createElement('video')
      
      video.onloadedmetadata = () => {
        resolve({ state: MediaLoadState.LOADED })
      }
      
      video.onerror = () => {
        const errorType = video.error ? getMediaErrorTypeFromCode(video.error.code) : MediaErrorType.UNKNOWN_ERROR
        const error = createMediaError(
          errorType,
          '视频加载失败',
          video.error || undefined
        )
        resolve({ state: MediaLoadState.ERROR, error })
      }
      
      video.preload = 'metadata'
      video.src = url
    } else {
      // 不支持的媒体类型
      const error = createMediaError(
        MediaErrorType.FORMAT_ERROR,
        '不支持的媒体格式'
      )
      resolve({ state: MediaLoadState.ERROR, error })
    }
  })
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 * @returns 格式化的文件大小字符串
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 格式化视频时长
 * @param seconds 秒数
 * @returns 格式化的时长字符串 (mm:ss 或 hh:mm:ss)
 */
export function formatVideoDuration(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00'
  
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)
  
  if (hours > 0) {
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  } else {
    return `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
  }
}

/**
 * 检查浏览器是否支持指定的视频格式（仅在浏览器环境中可用）
 * @param mimeType 视频MIME类型
 * @returns 是否支持该格式
 */
export function canPlayVideoFormat(mimeType: string): boolean {
  // 检查是否在浏览器环境中
  if (typeof window === 'undefined' || !(window as any).document) {
    return false
  }
  
  const video = (window as any).document.createElement('video')
  return video.canPlayType(mimeType) !== ''
}

/**
 * 检查文件是否为支持的视频格式
 * @param filePath 文件路径
 * @returns 是否为支持的视频格式
 */
export function isSupportedVideoFormat(filePath: string): boolean {
  if (!isVideoFile(filePath)) {
    return false
  }
  
  const mimeType = getMediaMimeType(filePath)
  if (!mimeType) {
    return false
  }
  
  return canPlayVideoFormat(mimeType)
}