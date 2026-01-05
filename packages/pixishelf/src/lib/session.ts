import type { NextRequest } from 'next/server'
import { authService } from './auth'
import { COOKIE_NAMES } from './constants'
import type { Session, CookieOptions, ApiSession } from '@/types/auth'
import type { User } from '@/types/core'
import logger from './logger'

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
      secure: this.getSecureSetting(),
      sameSite: 'strict',
      maxAge: 60 * 60 * 24 * 7, // 7天
      path: '/'
    }
  }

  /**
   * 智能获取 secure 设置
   * 在生产环境中启用，但对 localhost 和 IP 访问禁用
   */
  private getSecureSetting(): boolean {
    // 开发环境直接返回 false
    if (process.env.NODE_ENV !== 'production') {
      return false
    }

    // // 生产环境中，检查是否为 localhost 或 IP 访问
    // if (window && typeof window !== 'undefined') {
    //   const hostname = window.location.hostname

    //   // localhost 或 IP 地址访问时禁用 secure
    //   if (hostname === 'localhost' || hostname === '127.0.0.1' || /^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
    //     return false
    //   }
    // }

    // 服务端环境中，检查环境变量
    const host = process.env.VERCEL_URL || process.env.HOST || ''
    if (host.includes('localhost') || host.includes('127.0.0.1') || /^\d+\.\d+\.\d+\.\d+/.test(host)) {
      return false
    }

    // 默认在生产环境中启用 secure
    return true
  }

  /**
   * 创建新会话
   * @param user - 用户信息
   * @returns Promise<Session> 会话信息
   */
  async createSession(user: any): Promise<Session> {
    try {
      const token = authService.generateAccessToken({ id: user.id, username: user.username })

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
   * 验证并可能刷新会话
   * @param token 当前令牌
   * @returns 返回一个有效的会话，如果需要，令牌会被刷新
   */
  async validateAndRefreshSession(token: string): Promise<Session | null> {
    const session = await this.getSession(token) // 第一次验证

    if (!session || !session.isActive) {
      return null
    }

    // 检查是否需要刷新
    if (authService.isTokenExpiringSoon(token)) {
      return this.refreshSession(token) // 内部会生成新令牌并返回新会话
    }

    return session // 如果不需要刷新，直接返回当前会话
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
      logger.error('获取会话失败:', error)
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
      logger.error('刷新会话失败:', error)
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
      logger.info('会话已销毁:', token.substring(0, 20) + '...')
    } catch (error) {
      logger.error('销毁会话失败:', error)
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
      logger.error('验证会话失败:', error)
      return false
    }
  }

  /**
   * 根据请求动态获取Cookie配置
   * @param headers - Next.js 请求对象
   * @param options - 自定义选项
   * @returns CookieOptions 合并后的配置
   */
  getCookieOptions(headers: NextRequest['headers'], options: Partial<CookieOptions> = {}): CookieOptions {
    const baseOptions = {
      ...this.defaultCookieOptions,
      ...options
    }

    // 根据请求的 host 动态设置 secure
    const host = headers.get('host') || ''
    const isLocalOrIP = host.includes('localhost') || host.includes('127.0.0.1') || /^\d+\.\d+\.\d+\.\d+/.test(host)

    return {
      ...baseOptions,
      secure: isLocalOrIP ? false : baseOptions.secure
    }
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
      logger.error('提取令牌失败:', error)
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
   * 从请求中提取用户会话
   */
  extractUserSessionFromRequest(request: NextRequest) {
    // 从请求头中获取由中间件注入的用户信息
    const sessionHeader = request.headers.get('x-user-session')!
    const user: ApiSession = JSON.parse(sessionHeader)
    return user
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
      logger.error('获取会话统计失败:', error)
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
