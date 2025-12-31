import type { AuthLoginRequestDTO, AuthLoginResponseDTO, AuthMeResponseDTO } from '@/schemas/auth.dto'
import type {
  ChangePasswordSchema,
  CreateUserSchema,
  CreateUserResponseDTO,
  GetUsersResponseDTO,
  UserDeleteSchema
} from '@/schemas/users.dto'
import { ApiResponse } from '@/types'

export type * from '@/schemas/users.dto'
export type * from '@/schemas/auth.dto'

export interface APIGET {
  '/api/auth/me': () => Promise<ApiResponse<AuthMeResponseDTO>>
  /** 获取用户列表 */
  '/api/users': () => Promise<ApiResponse<GetUsersResponseDTO>>
}

export interface APIPOST {
  /** 登录 */
  '/api/auth/login': (data: AuthLoginRequestDTO) => Promise<ApiResponse<AuthLoginResponseDTO>>
  /** 创建用户 */
  '/api/users': (data: CreateUserSchema) => Promise<ApiResponse<CreateUserResponseDTO>>
  /** 退出登录 */
  '/api/auth/logout': () => Promise<ApiResponse>
}

export interface APIPUT {
  /** 修改密码 */
  '/api/users/password': (data: ChangePasswordSchema) => Promise<ApiResponse>
}

export interface APIDELETE {
  /** 删除用户 */
  '/api/users/[id]': (data: UserDeleteSchema) => Promise<ApiResponse>
}

export interface APIOPTIONS {}
