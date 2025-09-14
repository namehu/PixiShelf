import { User } from './core'

// ============================================================================
// 认证相关类型
// ============================================================================

/**
 * 登录请求
 */
export interface LoginRequest {
  username: string
  password: string
}

/**
 * 登录响应
 */
export interface LoginResponse {
  token: string
  user: Pick<User, 'id' | 'username'>
}

/**
 * 创建用户请求
 */
export interface CreateUserRequest {
  username: string
  password: string
}

/**
 * 创建用户响应
 */
export interface CreateUserResponse {
  id: number
  username: string
}

/**
 * 修改密码请求
 */
export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

/**
 * 修改密码响应
 */
export interface ChangePasswordResponse {
  success: boolean
  message: string
}