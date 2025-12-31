import type { AuthLoginRequestDTO, AuthLoginResponseDTO, AuthMeResponseDTO } from '@/schemas/auth.dto'
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

export interface APIPUT {}

export interface APIDELETE {}

export interface APIOPTIONS {}
