import type { ArtistGetSchema, ArtistsGetRequest, ArtistResponseDto } from '@/schemas/artist.dto'
import type { PaginationResponseData } from '@/types'

export type * from '@/schemas/users.dto'
export type * from '@/schemas/auth.dto'
export type * from '@/schemas/health.dto'
export type * from '@/schemas/artist.dto'

export interface APIGET {
  /** 获取艺术家列表 */
  '/api/artists': (data: ArtistsGetRequest) => Promise<PaginationResponseData<ArtistResponseDto>>
  /** 获取单个艺术家详情 */
  '/api/artists/[id]': (data: ArtistGetSchema) => Promise<ArtistResponseDto>
}

export interface APIPOST {}

export interface APIPUT {}

export interface APIDELETE {}

export interface APIOPTIONS {}
