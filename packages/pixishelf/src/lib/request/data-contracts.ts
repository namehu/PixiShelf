import type { ArtistGetSchema, ArtistsGetRequest, ArtistResponseDto } from '@/schemas/artist.dto'
import type { AuthMeResponseDTO } from '@/schemas/auth.dto'
import { HealthResponseSchema } from '@/schemas/health.dto'
import type { PaginationResponseData } from '@/types'
import type {
  CreateUserSchema,
  CreateUserResponseDTO,
  GetUsersResponseDTO,
  UserDeleteSchema
} from '@/schemas/users.dto'

export type * from '@/schemas/users.dto'
export type * from '@/schemas/auth.dto'
export type * from '@/schemas/health.dto'
export type * from '@/schemas/artist.dto'

export interface APIGET {
  /** 获取艺术家列表 */
  '/api/artists': (data: ArtistsGetRequest) => Promise<PaginationResponseData<ArtistResponseDto>>
  /** 获取单个艺术家详情 */
  '/api/artists/[id]': (data: ArtistGetSchema) => Promise<ArtistResponseDto>
  /** 健康检查 */
  '/api/health': () => Promise<HealthResponseSchema>
  /** 获取用户列表 */
  '/api/users': () => Promise<GetUsersResponseDTO>
}

export interface APIPOST {
  /** 创建用户 */
  '/api/users': (data: CreateUserSchema) => Promise<CreateUserResponseDTO>
}

export interface APIPUT {}

export interface APIDELETE {
  /** 删除用户 */
  '/api/users/[id]': (data: UserDeleteSchema) => Promise<void>
}

export interface APIOPTIONS {}
