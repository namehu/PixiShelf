// ============================================================================
// 标签广场相关类型定义
// ============================================================================

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

// ============================================================================
// 标签翻译管理相关类型定义
// ============================================================================

/**
 * 标签管理列表请求参数
 */
export interface TagManagementParams {
  /** 页码，默认1 */
  page?: number
  /** 每页数量，默认30，最大100 */
  limit?: number
  /** 搜索关键词 */
  search?: string
  /** 筛选条件 */
  filter?: 'all' | 'translated' | 'untranslated'
  /** 排序字段 */
  sort?: 'name' | 'name_zh' | 'name_en' | 'artworkCount' | 'createdAt' | 'updatedAt'
  /** 排序方向 */
  order?: 'asc' | 'desc'
}

/**
 * 标签管理统计信息
 */
export interface TagManagementStats {
  /** 标签总数 */
  totalTags: number
  /** 已翻译标签数 */
  translatedTags: number
  /** 未翻译标签数 */
  untranslatedTags: number
  /** 翻译完成率 */
  translationRate: number
}
