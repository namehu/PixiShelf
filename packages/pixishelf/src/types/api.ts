import { Artist, Artwork, User, MediaFile } from './core'

// ============================================================================
// API 请求/响应类型
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
  user: {
    id: string
    username: string
  }
}

/**
 * 用户信息响应
 */
export interface UserResponse {
  id: string
  username: string
  createdAt: string
  updatedAt: string
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
  success: boolean
  user?: {
    id: number
    username: string
    createdAt: string
  }
  error?: string
}

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
  | 'title_asc'        // 按名称升序
  | 'title_desc'       // 按名称降序
  | 'artist_asc'       // 按艺术家名称升序
  | 'artist_desc'      // 按艺术家名称降序
  | 'images_desc'      // 按图片数量降序
  | 'images_asc'       // 按图片数量升序
  | 'source_date_desc' // 按作品创建时间降序（默认）
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
 * 艺术家列表查询参数
 */
export interface ArtistsQuery extends PaginationQuery {
  search?: string // 搜索关键词（搜索艺术家名称、用户名）
  sortBy?: 'name_asc' | 'name_desc' | 'artworks_desc' | 'artworks_asc' // 排序选项
}

/**
 * 艺术家列表响应
 */
export type ArtistsResponse = PaginatedResponse<Artist>

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
 * 增强的作品响应（包含媒体类型信息）
 */
export interface EnhancedArtwork extends Omit<Artwork, 'images'> {
  images: MediaFile[]
  videoCount?: number // 视频文件数量
  totalMediaSize?: number // 总媒体文件大小
}

/**
 * 增强的作品列表响应
 */
export type EnhancedArtworksResponse = PaginatedResponse<EnhancedArtwork>

/**
 * 媒体文件详情响应
 */
export interface MediaFileResponse {
  file: MediaFile
  url: string
  thumbnailUrl?: string // 视频缩略图URL
  previewUrl?: string // 视频预览URL
}

/**
 * 通用API响应
 */
export interface ApiResponse<T = any> {
  success: boolean
  data?: T
  error?: string
  message?: string
}

/**
 * 健康检查响应
 */
export interface HealthCheckResponse {
  status: 'ok' | 'error'
  timestamp: string
  uptime: number
  version?: string
}

/**
 * 文件上传响应
 */
export interface FileUploadResponse {
  success: boolean
  filename?: string
  url?: string
  size?: number
  error?: string
}

/**
 * 批量操作响应
 */
export interface BatchOperationResponse {
  success: boolean
  processed: number
  failed: number
  errors?: string[]
}