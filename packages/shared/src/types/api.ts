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
 * 排序选项类型
 */
export type SortOption = 
  | 'newest'           // 按最新添加（默认）
  | 'title_asc'        // 按名称升序
  | 'title_desc'       // 按名称降序
  | 'artist_asc'       // 按艺术家名称升序
  | 'artist_desc'      // 按艺术家名称降序
  | 'images_desc'      // 按图片数量降序
  | 'images_asc'       // 按图片数量升序
  | 'source_date_desc' // 按作品创建时间降序
  | 'source_date_asc'  // 按作品创建时间升序

/**
 * 作品列表查询参数
 */
export interface ArtworksQuery extends PaginationQuery {
  tags?: string // 逗号分隔的标签列表
  search?: string // 模糊搜索关键词（搜索作品标题、描述、艺术家名称）
  sortBy?: SortOption // 排序选项
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
 * 搜索建议项
 */
export interface SearchSuggestion {
  type: 'artwork' | 'artist' | 'tag'
  value: string
  label: string
  metadata?: {
    artistName?: string
    imageCount?: number
    artworkCount?: number
  }
}

/**
 * 搜索建议响应
 */
export interface SuggestionsResponse {
  suggestions: SearchSuggestion[]
}

/**
 * API 响应包装器
 */
export type ApiResponse<T> = T | ErrorResponse