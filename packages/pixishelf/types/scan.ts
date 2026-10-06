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
  totalArtworks: number // 发现的作品总数
  newArtists: number // 新增艺术家数
  newTags: number // 新增标签数
  skippedArtworks: number // 跳过的作品数
  processingTime: number // 处理时间（毫秒）
  newArtworks: number // 新增作品数
  newImages: number // 新增图片数
  removedArtworks?: number // 删除的作品数
  errors: string[] // 错误信息
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
 * SSE 日志条目
 */
export interface LogEntry {
  timestamp: string
  type: 'progress' | 'complete' | 'error' | 'cancelled' | 'connection' | 'info'
  data: any
  message: string
}

/** legacy 执行模式建立扫描 SSE 连接后的事件；中央入队事件由 queuedSseResponse 定义。 */
export interface ScanSseEventMap {
  ping: Record<string, never>
  connection: { success: true; result: string }
  progress: ScanProgress
  complete: { success: true; result: ScanResult }
  cancelled: { success: false; error: string }
  error: { success: false; error: string }
}
