// 服务相关类型定义

import { TaskStats } from './pixiv'
import { ImageDownloadData, ImageDownloadResult } from './messages'

// 服务操作结果
export interface ServiceResult<T = any> {
  success: boolean
  data?: T
  error?: string
  code?: string
}

// 任务执行状态
export interface TaskExecutionState {
  isRunning: boolean
  currentTag?: string
  startTime?: number
  pauseTime?: number
  resumeTime?: number
}

// 任务配置
export interface TaskConfiguration {
  concurrentRequests: number
  minDelayMs: number
  maxDelayMs: number
  rateLimitWaitMs: number
  maxRetries: number
  timeout: number
}

// API请求选项
export interface ApiRequestOptions {
  timeout?: number
  retries?: number
  delay?: number
  headers?: Record<string, string>
}

// 翻译请求参数
export interface TranslationRequest {
  tag: string
  options?: ApiRequestOptions
}

// 翻译响应
export interface TranslationResponse {
  tag: string
  translation: string | null
  englishTranslation: string | null
  abstract: string | null
  imageUrl: string | null
  success: boolean
  error?: string
}

// 下载模式类型
export type DownloadMode = 'individual' | 'zip'

// 下载请求
export interface DownloadRequest {
  images: ImageDownloadData[]
  downloadMode?: DownloadMode // 下载模式：individual-单独下载，zip-打包下载
  customDirectory?: string // 自定义下载目录，如 "tags"
  onProgress?: (current: number, total: number) => void
  onImageComplete?: (result: ImageDownloadResult) => void
}

// 文件下载选项
export interface FileDownloadOptions {
  filename: string
  mimeType?: string
  encoding?: string
}

// SQL生成选项
export interface SqlGenerationOptions {
  tableName?: string
  updateFields?: string[]
  whereField?: string
  includeComments?: boolean
}

// 进度回调函数类型
export type ProgressCallback = (current: number, total: number, item?: string) => void
export type CompletionCallback<T> = (result: ServiceResult<T>) => void
export type ErrorCallback = (error: string, code?: string) => void

// 服务事件类型
export interface ServiceEvent {
  type: 'start' | 'progress' | 'complete' | 'error' | 'pause' | 'resume'
  data?: any
  timestamp: number
}

// 服务监听器
export type ServiceEventListener = (event: ServiceEvent) => void

// Pixiv服务接口
export interface IPixivService {
  // 任务管理
  startTask(tags: string[], config?: Partial<TaskConfiguration>): Promise<ServiceResult>

  // 标签操作
  addTags(tags: string[]): Promise<ServiceResult>
  removeTag(tag: string): Promise<ServiceResult>
  clearTags(): Promise<ServiceResult>
  getTags(): Promise<string[]>

  // 翻译功能
  translateTag(tag: string, options?: ApiRequestOptions): Promise<TranslationResponse>

  // 数据导出
  generateSql(options?: SqlGenerationOptions): Promise<ServiceResult<string>>
  downloadSqlFile(options?: SqlGenerationOptions & FileDownloadOptions): Promise<ServiceResult>

  // 图片下载
  downloadTagImages(request?: DownloadRequest): Promise<ServiceResult>

  // 进度管理
  getProgress(): Promise<TaskStats>
  clearProgress(): Promise<ServiceResult>

  // 清理
  dispose(): void
}

// 默认任务配置
export const DEFAULT_TASK_CONFIG: TaskConfiguration = {
  concurrentRequests: 3,
  minDelayMs: 1000,
  maxDelayMs: 4000, // 修复：与原始脚本保持一致
  rateLimitWaitMs: 60000,
  maxRetries: 3,
  timeout: 10000
}

// 错误代码
export const ERROR_CODES = {
  NETWORK_ERROR: 'NETWORK_ERROR',
  RATE_LIMITED: 'RATE_LIMITED',
  INVALID_RESPONSE: 'INVALID_RESPONSE',
  TASK_ALREADY_RUNNING: 'TASK_ALREADY_RUNNING',
  TASK_NOT_RUNNING: 'TASK_NOT_RUNNING',
  STORAGE_ERROR: 'STORAGE_ERROR',
  DOWNLOAD_FAILED: 'DOWNLOAD_FAILED',
  INVALID_TAG: 'INVALID_TAG'
} as const
