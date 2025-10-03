import jwt from 'jsonwebtoken'
import { userRepository } from './repositories/user'
import { hashPassword, verifyPassword } from './crypto'
import { JWT_CONFIG } from './constants'
import type { User } from '@/types/core'
import type { JWTPayload } from '@/types/auth'
import { sessionManager } from './session'
import { NextRequest } from 'next/server'

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
  generateAccessToken(user: User): string
  verifyAccessToken(token: string): Promise<User | null>
  refreshToken(token: string): Promise<string | null>
  createUser(username: string, password: string): Promise<User>
  changePassword(userId: number, currentPassword: string, newPassword: string): Promise<void>
}

/**
 * 认证服务实现
 */
export class AuthService implements IAuthService {
  private readonly jwtSecret: string
  private readonly jwtTtl: number

  constructor() {
    this.jwtSecret = process.env.JWT_SECRET || 'dev-secret-key'
    this.jwtTtl = parseInt(String(JWT_CONFIG.DEFAULT_TTL), 10)

    if (process.env.NODE_ENV === 'production' && this.jwtSecret === 'dev-secret-key') {
      console.warn('警告：生产环境未设置 JWT_SECRET 环境变量，使用默认密钥')
      // throw new Error('生产环境必须设置 JWT_SECRET 环境变量')
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
  generateAccessToken(user: User): string {
    try {
      const payload: JWTPayload = {
        userId: `${user.id}`,
        sub: `${user.id}`,
        username: user.username,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + this.jwtTtl
      }

      const token = jwt.sign(payload, this.jwtSecret, {
        algorithm: 'HS256'
      })

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
      const decoded = jwt.verify(token, this.jwtSecret) as JWTPayload

      // 检查令牌是否过期
      const now = Math.floor(Date.now() / 1000)
      if (decoded.exp && decoded.exp < now) {
        return null
      }

      // 查找用户（确保用户仍然存在）
      // const user = await userRepository.findById(parseInt(decoded.sub))
      // if (!user) {
      //   return null
      // }

      // 2. 直接从令牌的载荷(payload)构建用户信息对象
      // 注意：这个User对象只包含令牌中存储的信息，
      // 对于中间件和大部分场景来说已经足够了。
      const user: User = {
        id: decoded.sub, // 'sub' (subject) 字段通常就是用户ID
        username: decoded.username,
        // 其他 User 接口中的字段可以设为默认值或空值，因为在认证层面我们不需要它们
        passwordHash: '', // 绝不能在令牌中存储密码哈希
        createdAt: new Date(decoded.iat * 1000).toISOString(), // iat (issued at) 是签发时间
        updatedAt: new Date(decoded.iat * 1000).toISOString() // 可以用签发时间作为近似值
      }
      return user
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        // JWT相关错误（无效、过期等）
        return null
      }

      throw new AuthError(`令牌验证失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
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

      // 检查是否需要刷新（距离过期时间小于阈值）
      const decoded = jwt.decode(token) as JWTPayload
      const now = Math.floor(Date.now() / 1000)
      const timeUntilExpiry = decoded.exp - now

      if (timeUntilExpiry > JWT_CONFIG.REFRESH_THRESHOLD) {
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
   * 创建新用户
   * @param username - 用户名
   * @param password - 密码
   * @returns Promise<User> 创建的用户信息
   */
  async createUser(username: string, password: string): Promise<User> {
    try {
      // 检查用户名是否已存在
      const existingUser = await userRepository.findByUsername(username)
      if (existingUser) {
        throw new AuthError('用户名已存在')
      }

      // 加密密码
      const hashedPassword = await hashPassword(password)

      // 创建用户
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
      // 查找用户
      const user = await userRepository.findById(userId)
      if (!user) {
        throw new AuthError('用户不存在')
      }

      // 验证当前密码
      const isCurrentPasswordValid = await verifyPassword(currentPassword, user.passwordHash)
      if (!isCurrentPasswordValid) {
        throw new AuthError('当前密码错误')
      }

      // 加密新密码
      const hashedNewPassword = await hashPassword(newPassword)

      // 更新密码
      await userRepository.updatePassword(userId, hashedNewPassword)
    } catch (error) {
      if (error instanceof AuthError) {
        throw error
      }

      throw new AuthError(`修改密码失败: ${error instanceof Error ? error.message : 'Unknown error'}`)
    }
  }

  /**
   * 检查令牌是否即将过期
   * @param token - JWT令牌
   * @returns boolean 是否即将过期
   */
  isTokenExpiringSoon(token: string): boolean {
    try {
      const decoded = jwt.decode(token) as JWTPayload
      if (!decoded || !decoded.exp) {
        return true
      }

      const now = Math.floor(Date.now() / 1000)
      const timeUntilExpiry = decoded.exp - now

      return timeUntilExpiry <= JWT_CONFIG.REFRESH_THRESHOLD
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
      const decoded = jwt.decode(token) as JWTPayload
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
      const decoded = jwt.decode(token) as JWTPayload
      return decoded
    } catch {
      return null
    }
  }
}

// 导出单例实例
export const authService = new AuthService()

// ============================================================================
// Next.js API 路由认证工具
// ============================================================================

/**
 * 认证结果接口
 */
export interface AuthResult {
  success: boolean
  user?: User
  error?: string
}

/**
 * 验证 Next.js API 路由中的认证
 * @param request - NextRequest 对象
 * @returns Promise<AuthResult> 认证结果
 */
export async function verifyAuth(request: NextRequest): Promise<AuthResult> {
  try {
    // 从请求头中提取 Authorization
    const token = sessionManager.extractTokenFromRequest(request)

    if (!token) {
      return {
        success: false,
        error: 'Missing authorization header'
      }
    }

    // 验证 token
    const user = await authService.verifyAccessToken(token)

    if (!user) {
      return {
        success: false,
        error: 'Invalid or expired token'
      }
    }

    return {
      success: true,
      user
    }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Authentication failed'
    }
  }
}
