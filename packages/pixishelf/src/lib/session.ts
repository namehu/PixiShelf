import type { NextRequest } from 'next/server'
import { authService } from './auth'
import type { Session } from '@/types/auth'
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
  extractTokenFromRequest(request: NextRequest): string | null
}

/**
 * 会话管理器实现
 */
export class SessionManager implements ISessionManager {
  constructor() {
    // 简化构造函数，移除cookie相关配置
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
      const token = await authService.generateAccessToken(userForToken)

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
   * 从请求中提取令牌
   * @param request - NextRequest对象
   * @returns string | null 提取到的token或null
   */
  extractTokenFromRequest(request: NextRequest): string | null {
    return authService.extractTokenFromRequest(request)
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
