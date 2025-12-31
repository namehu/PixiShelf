import type { AuthLoginRequestDTO, AuthLoginResponseDTO, AuthMeResponseDTO } from '@/schemas/auth.dto'
import type { ChangePasswordSchema } from '@/schemas/users.dto'
import { ApiResponse } from '@/types'

export interface APIGET {
  '/api/auth/me': () => Promise<ApiResponse<AuthMeResponseDTO>>
}

export interface APIPOST {
  /** 登录 */
  '/api/auth/login': (data: AuthLoginRequestDTO) => Promise<ApiResponse<AuthLoginResponseDTO>>
  /** 退出登录 */
  '/api/auth/logout': () => Promise<ApiResponse>
}

export interface APIPUT {
  /** 修改密码 */
  '/api/users/password': (data: ChangePasswordSchema) => Promise<ApiResponse>
}

export interface APIDELETE {}

export interface APIOPTIONS {}
