// ============================================================================
// 认证相关类型定义
// ============================================================================

/**
 * 会话数据
 */
export interface Session {
  /** 会话ID */
  id: string
  /** 用户ID */
  userId: string
  /** 用户名 */
  username: string
  /** 访问令牌 */
  token: string
  /** 刷新令牌 */
  refreshToken?: string
  /** 创建时间 */
  createdAt: Date
  /** 过期时间 */
  expiresAt: Date
  /** 最后访问时间 */
  lastAccessedAt: Date
  /** 是否活跃 */
  isActive: boolean
}

export interface ApiSession extends Omit<Session, 'userId'> {
  userId: number
}

// ----------------------------------------------------------------------------
// JWT相关类型
// ----------------------------------------------------------------------------

/**
 * JWT载荷
 */
export interface JWTPayload {
  /** 用户ID */
  userId: string
  /** 用户名 */
  username: string
  /** 主题（用户ID的别名） */
  sub: string
  /** 签发时间 */
  iat: number
  /** 过期时间 */
  exp: number
  /** 签发者 */
  iss?: string
  /** 受众 */
  aud?: string
}

/**
 * JWT验证结果
 */
export interface JWTVerifyResult {
  /** 是否有效 */
  valid: boolean
  /** 载荷数据 */
  payload?: JWTPayload
  /** 错误信息 */
  error?: string
}
