// ============================================================================
// 设置相关类型
// ============================================================================

/**
 * 扫描路径设置请求
 */
export interface ScanPathRequest {
  scanPath: string
}

/**
 * 扫描路径设置响应
 */
export interface ScanPathResponse {
  scanPath: string | null
}

/**
 * 设置更新响应
 */
export interface SettingsUpdateResponse {
  success: boolean
}