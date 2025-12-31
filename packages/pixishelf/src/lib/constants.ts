// ============================================================================
// 应用常量定义
// ============================================================================

/**
 * 页面路径
 */
export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  DASHBOARD: '/dashboard',
  GALLERY: '/gallery',
  ARTWORKS: '/artworks',
  ARTISTS: '/artists',
  ADMINSETTING: '/admin/setting',
  ADMINSTATS: '/admin/stats',
  TAGS: '/tags',
  VIEWER: '/viewer',
  CHANGE_PASSWORD: '/change-password'
} as const

/**
 * 本地存储键名
 */
export const STORAGE_KEYS = {
  AUTH_TOKEN: 'auth-token',
  USER_PREFERENCES: 'user-preferences',
  THEME: 'theme'
} as const

/**
 * Cookie名称
 */
export const COOKIE_NAMES = {
  AUTH_TOKEN: 'auth-token',
  REFRESH_TOKEN: 'refresh-token',
  USER_PREFERENCES: 'user-preferences'
} as const

/**
 * Cookie配置
 */
export const COOKIE_CONFIG = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  maxAge: 7 * 24 * 60 * 60, // 7天
  path: '/'
}

/**
 * JWT 配置
 */
export const JWT_CONFIG = {
  DEFAULT_TTL: process.env.JWT_TTL ?? 60 * 60 * 24 * 7, // 7天（秒）
  REFRESH_THRESHOLD: 60 * 60 * 24 // 1天（秒）
} as const

/**
 * 分页配置
 */
export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 100
} as const

/**
 * 表单验证配置
 */
export const VALIDATION = {
  USERNAME: {
    MIN_LENGTH: 3,
    MAX_LENGTH: 20,
    PATTERN: /^[a-zA-Z0-9_-]+$/
  },
  PASSWORD: {
    MIN_LENGTH: 6,
    MAX_LENGTH: 128
  }
} as const

/**
 * 错误消息
 */
export const ERROR_MESSAGES = {
  NETWORK_ERROR: '网络连接失败，请检查网络设置',
  UNAUTHORIZED: '未授权访问，请重新登录',
  FORBIDDEN: '权限不足，无法访问该资源',
  NOT_FOUND: '请求的资源不存在',
  SERVER_ERROR: '服务器内部错误，请稍后重试',
  VALIDATION_ERROR: '输入数据格式错误',
  LOGIN_FAILED: '用户名或密码错误',
  LOGIN_REQUIRED: '请先登录'
} as const
