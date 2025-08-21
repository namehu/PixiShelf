// ============================================================================
// 扫描相关类型
// ============================================================================

/**
 * 扫描请求
 */
export interface ScanRequest {
  force?: boolean
}

/**
 * 扫描结果
 */
export interface ScanResult {
  scannedDirectories: number
  foundImages: number
  newArtworks: number
  newImages: number
  removedArtworks?: number
  errors: string[]
  skippedDirectories?: Array<{ path: string; reason: string }>
}

/**
 * 扫描进度信息
 */
export interface ScanProgress {
  phase: 'counting' | 'scanning' | 'creating' | 'cleanup' | 'complete'
  message: string
  current?: number
  total?: number
  percentage?: number
  estimatedSecondsRemaining?: number
}

/**
 * 扫描状态响应
 */
export interface ScanStatusResponse {
  scanning: boolean
  message?: string | null
}

/**
 * 扫描取消响应
 */
export interface ScanCancelResponse {
  success: boolean
  cancelled: boolean
}

/**
 * SSE 日志条目
 */
export interface LogEntry {
  timestamp: string
  type: 'progress' | 'complete' | 'error' | 'cancelled' | 'connection'
  data: any
  message: string
}