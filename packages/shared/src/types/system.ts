// ============================================================================
// 系统状态类型
// ============================================================================

/**
 * 健康检查响应
 */
export interface HealthResponse {
  status: string
  scanPath: string | null
}

/**
 * 应用状态
 */
export interface AppState {
  scanning: boolean
  cancelRequested: boolean
  lastProgressMessage: string | null
}