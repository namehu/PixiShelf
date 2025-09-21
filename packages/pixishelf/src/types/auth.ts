// ============================================================================
// 认证相关类型定义
// ============================================================================

import type { User } from './core'

// ----------------------------------------------------------------------------
// 登录相关类型
// ----------------------------------------------------------------------------

// 登录相关类型已移至 api.ts 文件

// ----------------------------------------------------------------------------
// 获取用户信息相关类型
// ----------------------------------------------------------------------------

/**
 * 获取当前用户信息响应
 */
export interface MeResponse {
  /** 操作是否成功 */
  success: boolean
  /** 用户信息（成功时返回） */
  user?: {
    id: string
    username: string
  }
  /** 错误信息（失败时返回） */
  error?: string
}

// ----------------------------------------------------------------------------
// 登出相关类型
// ----------------------------------------------------------------------------

/**
 * 登出响应数据
 */
export interface LogoutResponse {
  /** 操作是否成功 */
  success: boolean
  /** 成功消息 */
  message?: string
  /** 错误信息（失败时返回） */
  error?: string
}

// 创建用户和密码相关类型已移至 api.ts 文件

// ----------------------------------------------------------------------------
// 会话相关类型
// ----------------------------------------------------------------------------

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

/**
 * Cookie选项
 */
export interface CookieOptions {
  /** 是否仅HTTP访问 */
  httpOnly: boolean
  /** 是否安全传输 */
  secure: boolean
  /** SameSite策略 */
  sameSite: 'strict' | 'lax' | 'none'
  /** 最大存活时间（秒） */
  maxAge: number
  /** 路径 */
  path: string
  /** 域名 */
  domain?: string
}

// ----------------------------------------------------------------------------
// 认证状态相关类型
// ----------------------------------------------------------------------------

/**
 * 认证状态
 */
export interface AuthState {
  /** 是否已认证 */
  isAuthenticated: boolean
  /** 当前用户 */
  user: User | null
  /** 是否正在加载 */
  isLoading: boolean
  /** 错误信息 */
  error: string | null
}

/**
 * 认证上下文
 */
export interface AuthContextType extends AuthState {
  /** 登录方法 */
  login: (username: string, password: string) => Promise<boolean>
  /** 登出方法 */
  logout: () => Promise<void>
  /** 刷新用户信息 */
  refreshUser: () => Promise<void>
  /** 清除错误 */
  clearError: () => void
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