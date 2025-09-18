import jwt from 'jsonwebtoken'
import type { NextRequest } from 'next/server'
import { authService } from './auth'
import { JWT_CONFIG, COOKIE_CONFIG, COOKIE_NAMES } from './constants'
import type { Session, CookieOptions, JWTPayload } from '@/types/auth'
import type { User } from '@/types/core'

// ============================================================================
// 会话管理服务
// ============================================================================

// 使用从 @/types/auth 导入的 Session 和 CookieOptions 接口

/**
 * 会话管理器接口
 */
export interface ISessionManager {
  createSession(user: User): Promise<Session>
  getSession(token: string): Promise<Session | null>
  refreshSession(token: string): Promise<Session | null>
  destroySession(token: string): Promise<void>
  validateSession(token: string): Promise<boolean>
}

/**
 * 会话管理器实现
 */
export class SessionManager implements ISessionManager {
  private readonly defaultCookieOptions: CookieOptions

  constructor() {
    this.defaultCookieOptions = {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7天
      path: '/'
    }
  }

  /**
   * 创建新会话
   * @param user - 用户信息
   * @returns Promise<Session> 会话信息
   */
  async createSession(user: any): Promise<Session> {
    try {
      // 转换用户类型并生成访问令牌
      const userForToken: User = {
        id: user.id.toString(),
        username: user.username,
        passwordHash: user.password,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
      const token = authService.generateAccessToken(userForToken)

      // 提取令牌信息
      const payload = authService.extractUserFromToken(token)
      if (!payload) {
        throw new Error('无法解析令牌信息')
      }

      const session: Session = {
        id: payload.userId,
        userId: payload.userId,
        username: payload.username,
        token,
        createdAt: new Date(payload.iat * 1000),
        expiresAt: new Date(payload.exp * 1000),
        lastAccessedAt: new Date(),
        isActive: true
      }

      return session
    } catch (error) {
      throw new Error(`创建会话失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * 获取会话信息
   * @param token - JWT令牌
   * @returns Promise<Session | null> 会话信息或null
   */
  async getSession(token: string): Promise<Session | null> {
    try {
      // 验证令牌并获取用户信息
      const user = await authService.verifyAccessToken(token)
      if (!user) {
        return null
      }

      // 提取令牌信息
      const payload = authService.extractUserFromToken(token)
      if (!payload) {
        return null
      }

      // 检查令牌是否过期
      const now = new Date()
      const expiresAt = new Date(payload.exp * 1000)
      const isValid = expiresAt > now

      const session: Session = {
        id: payload.userId,
        userId: payload.userId,
        username: payload.username,
        token,
        createdAt: new Date(payload.iat * 1000),
        expiresAt: new Date(payload.exp * 1000),
        lastAccessedAt: new Date(),
        isActive: isValid
      }

      return session
    } catch (error) {
      console.error('获取会话失败:', error)
      return null
    }
  }

  /**
   * 刷新会话
   * @param token - 当前JWT令牌
   * @returns Promise<Session | null> 新会话信息或null
   */
  async refreshSession(token: string): Promise<Session | null> {
    try {
      // 获取当前会话
      const currentSession = await this.getSession(token)
      if (!currentSession || !currentSession.isActive) {
        return null
      }

      // 检查是否需要刷新
      if (!authService.isTokenExpiringSoon(token)) {
        return currentSession
      }

      // 刷新令牌
      const newToken = await authService.refreshToken(token)
      if (!newToken) {
        return null
      }

      // 由于Session不再包含user对象，需要重新获取用户信息
      // 这里简化处理，直接返回当前会话的刷新版本
      const payload = authService.extractUserFromToken(newToken)
      if (!payload) {
        return null
      }

      return {
        id: payload.userId,
        userId: payload.userId,
        username: payload.username,
        token: newToken,
        createdAt: new Date(payload.iat * 1000),
        expiresAt: new Date(payload.exp * 1000),
        lastAccessedAt: new Date(),
        isActive: true
      }
    } catch (error) {
      console.error('刷新会话失败:', error)
      return null
    }
  }

  /**
   * 销毁会话
   * @param token - JWT令牌
   * @returns Promise<void>
   */
  async destroySession(token: string): Promise<void> {
    try {
      // 在实际应用中，这里可能需要将令牌加入黑名单
      // 目前JWT是无状态的，所以主要是客户端清除令牌
      console.log('会话已销毁:', token.substring(0, 20) + '...')
    } catch (error) {
      console.error('销毁会话失败:', error)
    }
  }

  /**
   * 验证会话是否有效
   * @param token - JWT令牌
   * @returns Promise<boolean> 是否有效
   */
  async validateSession(token: string): Promise<boolean> {
    try {
      const session = await this.getSession(token)
      return session !== null && session.isActive
    } catch (error) {
      console.error('验证会话失败:', error)
      return false
    }
  }

  /**
   * 获取Cookie配置
   * @param options - 自定义选项
   * @returns CookieOptions 合并后的配置
   */
  getCookieOptions(options: Partial<CookieOptions> = {}): CookieOptions {
    return {
      ...this.defaultCookieOptions,
      ...options
    }
  }

  /**
   * 格式化Cookie字符串
   * @param name - Cookie名称
   * @param value - Cookie值
   * @param options - Cookie选项
   * @returns string Cookie字符串
   */
  formatCookieString(name: string, value: string, options: Partial<CookieOptions> = {}): string {
    const opts = this.getCookieOptions(options)
    let cookieString = `${name}=${value}`

    if (opts.maxAge) {
      cookieString += `; Max-Age=${opts.maxAge}`
    }

    if (opts.path) {
      cookieString += `; Path=${opts.path}`
    }

    if (opts.domain) {
      cookieString += `; Domain=${opts.domain}`
    }

    if (opts.secure) {
      cookieString += '; Secure'
    }

    if (opts.httpOnly) {
      cookieString += '; HttpOnly'
    }

    if (opts.sameSite) {
      cookieString += `; SameSite=${opts.sameSite}`
    }

    return cookieString
  }

  /**
   * 创建删除Cookie的字符串
   * @param name - Cookie名称
   * @param options - Cookie选项
   * @returns string 删除Cookie的字符串
   */
  createDeleteCookieString(name: string, options: Partial<CookieOptions> = {}): string {
    const deleteOptions: Partial<CookieOptions> = {
      ...options,
      maxAge: 0
    }
    return this.formatCookieString(name, '', deleteOptions)
  }

  /**
   * 从请求头中提取令牌
   * @param cookieHeader - Cookie请求头
   * @returns string | null 令牌或null
   */
  extractTokenFromCookies(cookieHeader: string): string | null {
    try {
      const cookies = cookieHeader.split(';').reduce(
        (acc, cookie) => {
          const [name, value] = cookie.trim().split('=')
          if (name && value && typeof name === 'string') {
            acc[name] = value
          }
          return acc
        },
        {} as Record<string, string>
      )

      return cookies[COOKIE_NAMES.AUTH_TOKEN] || null
    } catch (error) {
      console.error('提取令牌失败:', error)
      return null
    }
  }

  /**
   * 从请求中提取令牌
   */
  extractTokenFromRequest(request: NextRequest): string | null {
    // 首先尝试从Cookie中获取
    const cookieToken = request.cookies.get('auth-token')?.value
    if (cookieToken) {
      return cookieToken
    }

    // 然后尝试从Authorization头中获取
    const authHeader = request.headers.get('authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7)
    }

    return null
  }

  /**
   * 获取会话统计信息
   * @param token - JWT令牌
   * @returns 会话统计信息
   */
  async getSessionStats(token: string): Promise<{
    isValid: boolean
    remainingTime: number | null
    isExpiringSoon: boolean
    user: { id: string; username: string } | null
  }> {
    try {
      const session = await this.getSession(token)

      if (!session) {
        return {
          isValid: false,
          remainingTime: null,
          isExpiringSoon: false,
          user: null
        }
      }

      const remainingTime = authService.getTokenRemainingTime(token)
      const isExpiringSoon = authService.isTokenExpiringSoon(token)

      return {
        isValid: session.isActive,
        remainingTime,
        isExpiringSoon,
        user: {
          id: session.userId,
          username: session.username
        }
      }
    } catch (error) {
      console.error('获取会话统计失败:', error)
      return {
        isValid: false,
        remainingTime: null,
        isExpiringSoon: false,
        user: null
      }
    }
  }
}

// 导出单例实例
export const sessionManager = new SessionManager()
