import { Artist, Artwork, User } from './core'

// ============================================================================
// API 请求/响应类型
// ============================================================================

/**
 * 通用分页查询参数
 */
export interface PaginationQuery {
  page?: string
  pageSize?: string
}

/**
 * 通用分页响应
 */
export interface PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/**
 * 作品列表查询参数
 */
export interface ArtworksQuery extends PaginationQuery {
  tags?: string // 逗号分隔的标签列表
}

/**
 * 作品列表响应
 */
export type ArtworksResponse = PaginatedResponse<Artwork>

/**
 * 艺术家列表响应
 */
export interface ArtistsResponse {
  items: Artist[]
}

/**
 * 用户列表响应
 */
export interface UsersResponse {
  items: Pick<User, 'id' | 'username' | 'createdAt'>[]
}

/**
 * 错误响应
 */
export interface ErrorResponse {
  statusCode: number
  error: string
  message: string
}

/**
 * API 响应包装器
 */
export type ApiResponse<T> = T | ErrorResponse