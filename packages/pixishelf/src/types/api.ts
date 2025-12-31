import { Artwork, User, MediaFile } from './core'

// ============================================================================
// API 请求/响应类型
// ============================================================================

/**
 * 修改密码请求
 */
export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
  confirmNewPassword: string
}

/**
 * 修改密码响应
 */
export interface ChangePasswordResponse {
  success: boolean
  message?: string
  error?: string
}

/**
 * 通用分页查询参数
 */
export interface PaginationQuery {
  page?: string
  pageSize?: string
}

/**
 * 通用分页响应
 * @deprecated 请使用 PaginationResponse<T> 替代
 */
export interface UnSafe_PaginatedResponse<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

/**
 * 统一的分页响应结构
 */
export interface PaginationResponse<T> {
  success: boolean
  errorCode?: number
  data: PaginationResponseData<T>
}

/**
 * 分页数据结构
 */
export interface PaginationResponseData<T> {
  data: T[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
    hasNextPage: boolean
    hasPrevPage: boolean
  }
}

/**
 * 排序选项类型
 */
export type SortOption =
  | 'title_asc' // 按名称升序
  | 'title_desc' // 按名称降序
  | 'artist_asc' // 按艺术家名称升序
  | 'artist_desc' // 按艺术家名称降序
  | 'images_desc' // 按图片数量降序
  | 'images_asc' // 按图片数量升序
  | 'source_date_desc' // 按作品创建时间降序（默认）
  | 'source_date_asc' // 按作品创建时间升序

/**
 * 媒体类型筛选选项
 */
export type MediaTypeFilter =
  | 'all' // 全部类型（默认）
  | 'image' // 仅图片
  | 'video' // 仅视频

/**
 * 作品列表查询参数
 */
export interface ArtworksQuery extends PaginationQuery {
  tags?: string // 逗号分隔的标签列表
  search?: string // 模糊搜索关键词（搜索作品标题、描述、艺术家名称）
  sortBy?: SortOption // 排序选项
  mediaType?: MediaTypeFilter // 媒体类型筛选
}

/**
 * 艺术家列表查询参数
 */
export interface ArtistsQuery extends PaginationQuery {
  search?: string // 搜索关键词（搜索艺术家名称、用户名）
  sortBy?: 'name_asc' | 'name_desc' | 'artworks_desc' | 'artworks_asc' // 排序选项
}

/**
 * 用户列表响应
 */
export interface UsersResponse {
  items: Pick<User, 'id' | 'username' | 'createdAt'>[]
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
 * 增强的作品响应（包含媒体类型信息）
 */
export interface EnhancedArtwork extends Omit<Artwork, 'images'> {
  images: MediaFile[]
  totalMediaSize?: number // 总媒体文件大小
}

/**
 * 增强的作品列表响应
 */
export type EnhancedArtworksResponse = UnSafe_PaginatedResponse<EnhancedArtwork>

/**
 * 通用API响应
 */
export interface ApiResponse<T = any> {
  /** 响应状态码 */
  code: number
  /** 响应数据 */
  data?: T
  /** 错误信息 */
  error?: string
  /**
   * @deprecated 废弃
   */
  success: boolean
  /**
   * @deprecated 废弃
   */
  message?: string
}

// 定义后端返回的标准结构
export interface ApiResponse<T = any> {
  success: boolean
  data?: T // 成功时的负载
  errorCode?: number // 失败时的错误码
  error?: string // 失败时的错误消息
  details?: any // 校验详情
}
