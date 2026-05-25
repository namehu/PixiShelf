// ============================================================================
// 常量定义
// ============================================================================

/**
 * 扫描阶段常量
 */
export const SCAN_PHASES = {
  SCANNING: 'scanning',
  CREATING: 'creating',
  CLEANUP: 'cleanup',
  COMPLETE: 'complete'
} as const

/**
 * SSE 事件类型常量
 */
export const SSE_EVENT_TYPES = {
  PROGRESS: 'progress',
  COMPLETE: 'complete',
  ERROR: 'error',
  CANCELLED: 'cancelled',
  CONNECTION: 'connection'
} as const

/**
 * HTTP 状态码常量
 */
export const HTTP_STATUS = {
  OK: 200,
  CREATED: 201,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  INTERNAL_SERVER_ERROR: 500
} as const