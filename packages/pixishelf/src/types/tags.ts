// ============================================================================
// 标签广场相关类型定义
// ============================================================================

import { Tag } from './core'

/**
 * 标签搜索请求参数
 */
export interface TagSearchParams {
  /** 搜索关键词 */
  q: string
  /** 页码，默认1 */
  page?: number
  /** 每页数量，默认20，最大100 */
  limit?: number
  /** 排序字段 */
  sort?: 'name' | 'artworkCount' | 'createdAt'
  /** 排序方向 */
  order?: 'asc' | 'desc'
}

/**
 * 热门标签请求参数
 */
export interface PopularTagsParams {
  /** 返回数量，默认50，最大200 */
  limit?: number
  /** 最小作品数量，默认1 */
  minCount?: number
}

/**
 * 随机标签请求参数
 */
export interface RandomTagsParams {
  /** 返回数量，默认10，最大50 */
  count?: number
  /** 最小作品数量，默认0 */
  minCount?: number
  /** 是否排除空标签(无作品)，默认false */
  excludeEmpty?: boolean
}

/**
 * 分页信息
 */
export interface PaginationInfo {
  /** 当前页码 */
  page: number
  /** 每页数量 */
  limit: number
  /** 总记录数 */
  totalCount: number
  /** 总页数 */
  totalPages: number
  /** 是否有下一页 */
  hasNextPage: boolean
  /** 是否有上一页 */
  hasPrevPage: boolean
}

/**
 * 标签搜索响应
 */
export interface TagSearchResponse {
  success: boolean
  data: {
    tags: Tag[]
    pagination: PaginationInfo
    query: {
      keyword: string
      sort: string
      order: string
    }
  }
}

/**
 * 热门标签统计信息
 */
export interface PopularTagsStats {
  /** 符合条件的标签总数 */
  totalTags: number
  /** 总作品数 */
  totalArtworks: number
  /** 平均作品数 */
  averageArtworkCount: number
  /** 最大作品数 */
  maxArtworkCount: number
  /** 返回的标签数量 */
  returnedCount: number
}

/**
 * 热门标签响应
 */
export interface PopularTagsResponse {
  success: boolean
  data: {
    tags: Tag[]
    stats: PopularTagsStats
    query: {
      limit: number
      minCount: number
    }
  }
}

/**
 * 随机标签统计信息
 */
export interface RandomTagsStats {
  /** 可用标签总数 */
  totalAvailable: number
  /** 请求数量 */
  requested: number
  /** 实际返回数量 */
  returned: number
}

/**
 * 随机标签响应
 */
export interface RandomTagsResponse {
  success: boolean
  data: {
    tags: Tag[]
    stats: RandomTagsStats
    query: {
      count: number
      minCount: number
      excludeEmpty: boolean
    }
  }
}

/**
 * 标签卡片显示模式
 */
export type TagCardMode = 'compact' | 'detailed' | 'minimal'

/**
 * 标签卡片属性
 */
export interface TagCardProps {
  /** 标签数据 */
  tag: Tag
  /** 显示模式 */
  mode?: TagCardMode
  /** 是否显示作品数量 */
  showCount?: boolean
  /** 是否显示描述 */
  showDescription?: boolean
  /** 点击回调 */
  onClick?: (tag: Tag) => void
  /** 自定义类名 */
  className?: string
}

/**
 * 标签广场组件属性
 */
export interface TagSquareProps {
  /** 初始显示的标签 */
  initialTags?: Tag[]
  /** 每页显示数量 */
  pageSize?: number
  /** 是否显示搜索框 */
  showSearch?: boolean
  /** 是否显示筛选器 */
  showFilters?: boolean
  /** 标签卡片模式 */
  cardMode?: TagCardMode
  /** 自定义类名 */
  className?: string
}

/**
 * API错误响应
 */
export interface TagApiError {
  success: false
  error: string
  message?: string
  details?: any
}

/**
 * 标签API响应联合类型
 */
export type TagApiResponse = TagSearchResponse | PopularTagsResponse | RandomTagsResponse | TagApiError