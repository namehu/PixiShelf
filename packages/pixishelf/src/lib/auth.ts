import { SignJWT, jwtVerify, decodeJwt } from 'jose'
import type { NextRequest } from 'next/server'
import { userRepository } from './repositories/user'
import { hashPassword, verifyPassword } from './crypto'
import { JWT_CONFIG } from './constants'
import type { User } from '@/types/core'
import type { JWTPayload } from '@/types/auth'

// ============================================================================
// 认证服务
// ============================================================================

/**
 * 认证错误类
 */
export class AuthError extends Error {
  constructor(
    message: string,
    public code?: string
  ) {
    super(message)
    this.name = 'AuthError'
  }
}

/**
 * 认证服务接口
 */
export interface IAuthService {
  validateCredentials(username: string, password: string): Promise<User | null>
  generateAccessToken(user: User): Promise<string>
  verifyAccessToken(token: string): Promise<User | null>
  refreshToken(token: string): Promise<string | null>
  createUser(username: string, password: string): Promise<User>
  changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void>
  extractTokenFromRequest(request: NextRequest): string | null
  extractUserFromToken(token: string): JWTPayload | null
  isTokenExpiringSoon(token: string, thresholdSeconds?: number): boolean
}

/**
 * 认证服务实现
 */
export class AuthService implements IAuthService {
  private readonly jwtSecret: Uint8Array
  private readonly jwtTtl: number

  constructor() {
    const secret = process.env.JWT_SECRET || 'dev-secret-key'
    this.jwtSecret = new TextEncoder().encode(secret) // jose 需要 Uint8Array 格式的 secret
    this.jwtTtl = parseInt(process.env.JWT_TTL || String(JWT_CONFIG.DEFAULT_TTL), 10)

    if (process.env.NODE_ENV === 'production' && secret === 'dev-secret-key') {
      throw new Error('生产环境必须设置 JWT_SECRET 环境变量')
    }
  }

  /**
   * 验证用户凭据
   * @param username - 用户名
   * @param password - 密码
   * @returns Promise<User | null> 验证成功返回用户信息，失败返回null
   */
  async validateCredentials(username: string, password: string): Promise<User | null> {
    try {
      // 查找用户
      const user = await userRepository.findByUsername(username)
      if (!user) {
        return null
      }

      // 验证密码
      const isPasswordValid = await verifyPassword(password, user.passwordHash)
      if (!isPasswordValid) {
        return null
      }

      return user
    } catch (error) {
      throw new AuthError(`凭据验证失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * 生成访问令牌
   * @param user - 用户信息
   * @returns string JWT令牌
   */
  async generateAccessToken(user: User): Promise<string> {
    try {
      const token = await new SignJWT({ userId: user.id, username: user.username })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(user.id))
        .setIssuedAt()
        .setExpirationTime(`${this.jwtTtl}s`) // jose 接受字符串格式的时间
        .sign(this.jwtSecret)

      return token
    } catch (error) {
      throw new AuthError(`令牌生成失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * 验证访问令牌
   * @param token - JWT令牌
   * @returns Promise<User | null> 验证成功返回用户信息，失败返回null
   */
  async verifyAccessToken(token: string): Promise<User | null> {
    try {
      // 验证JWT令牌
      const { payload } = await jwtVerify(token, this.jwtSecret)
      const decoded = payload
      // 查找用户（确保用户仍然存在）
      const user = await userRepository.findById(parseInt(decoded.sub!))
      if (!user) {
        return null
      }

      return user
    } catch (error) {
      // jose 的错误通常有 code 属性，例如 'ERR_JWT_EXPIRED'
      // 为了简单起见，所有验证失败都返回 null
      return null
    }
  }

  /**
   * 刷新令牌
   * @param token - 当前JWT令牌
   * @returns Promise<string | null> 新令牌或null
   */
  async refreshToken(token: string): Promise<string | null> {
    try {
      const user = await this.verifyAccessToken(token)
      if (!user) {
        return null
      }

      // 检查是否需要刷新
      if (!this.isTokenExpiringSoon(token)) {
        // 还不需要刷新
        return token
      }

      // 生成新令牌
      return this.generateAccessToken(user)
    } catch (error) {
      throw new AuthError(`令牌刷新失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * 轻量级验证访问令牌，仅用于 Edge Runtime
   * 只验证签名和时效，不查询数据库
   * @param token - JWT令牌
   * @returns Promise<JWTPayload | null> 验证成功返回 payload，失败返回null
   */
  async lightweightVerifyAccessToken(token: string): Promise<JWTPayload | null> {
    try {
      const { payload } = await jwtVerify(token, this.jwtSecret)
      return payload as unknown as JWTPayload
    } catch (error) {
      // 令牌过期、签名无效等都会在这里捕获
      console.error('Lightweight token verification failed:', error)
      return null
    }
  }

  /**
   * 创建新用户
   * @param username - 用户名
   * @param password - 密码
   * @returns Promise<User> 创建的用户信息
   */
  async createUser(username: string, password: string): Promise<User> {
    try {
      const existingUser = await userRepository.findByUsername(username)
      if (existingUser) {
        throw new AuthError('用户名已存在')
      }

      const hashedPassword = await hashPassword(password)

      const user = await userRepository.create({
        username,
        passwordHash: hashedPassword
      })

      return user
    } catch (error) {
      if (error instanceof AuthError) {
        throw error
      }

      throw new AuthError(`创建用户失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * 修改密码
   * @param userId - 用户ID
   * @param currentPassword - 当前密码
   * @param newPassword - 新密码
   * @returns Promise<void>
   */
  async changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void> {
    try {
      const user = await userRepository.findById(userId)
      if (!user) {
        throw new AuthError('用户不存在')
      }

      const isCurrentPasswordValid = await verifyPassword(currentPassword, user.passwordHash)
      if (!isCurrentPasswordValid) {
        throw new AuthError('当前密码错误')
      }

      const hashedNewPassword = await hashPassword(newPassword)

      await userRepository.updatePassword(userId, hashedNewPassword)
    } catch (error) {
      if (error instanceof AuthError) {
        throw error
      }

      throw new AuthError(`修改密码失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * 从请求中提取token
   * @param request - NextRequest对象
   * @returns string | null 提取到的token或null
   */
  extractTokenFromRequest(request: NextRequest): string | null {
    const authHeader = request.headers.get('authorization')
    if (authHeader && authHeader.startsWith('Bearer ')) {
      return authHeader.substring(7)
    }

    const tokenFromQuery = request.nextUrl.searchParams.get('token')
    if (tokenFromQuery) {
      return tokenFromQuery
    }

    return null
  }

  /**
   * 检查令牌是否即将过期
   * @param token - JWT令牌
   * @param thresholdSeconds - 过期阈值（秒），默认为JWT_CONFIG.REFRESH_THRESHOLD
   * @returns boolean 是否即将过期
   */
  isTokenExpiringSoon(token: string, thresholdSeconds: number = JWT_CONFIG.REFRESH_THRESHOLD): boolean {
    try {
      const decoded = decodeJwt(token) as JWTPayload
      if (!decoded || !decoded.exp) {
        return true
      }

      const now = Math.floor(Date.now() / 1000)
      const timeUntilExpiry = decoded.exp - now

      return timeUntilExpiry <= thresholdSeconds
    } catch {
      return true
    }
  }

  /**
   * 获取令牌剩余有效时间（秒）
   * @param token - JWT令牌
   * @returns number | null 剩余时间或null
   */
  getTokenRemainingTime(token: string): number | null {
    try {
      const decoded = decodeJwt(token) as JWTPayload
      if (!decoded || !decoded.exp) {
        return null
      }

      const now = Math.floor(Date.now() / 1000)
      const remainingTime = decoded.exp - now

      return Math.max(0, remainingTime)
    } catch {
      return null
    }
  }

  /**
   * 从令牌中提取用户信息
   * @param token - JWT令牌
   * @returns JWTPayload | null 用户信息或null
   */
  extractUserFromToken(token: string): JWTPayload | null {
    try {
      return decodeJwt(token) as JWTPayload
    } catch {
      return null
    }
  }
}

// 导出单例实例
export const authService = new AuthService()
