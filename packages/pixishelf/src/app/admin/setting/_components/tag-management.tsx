'use client'

import { useState, useEffect } from 'react'
import { useDebounce } from '@/hooks/useDebounce'
import { toast } from 'sonner'
import { BarChart3 } from 'lucide-react'
import type { TagManagementParams } from '@/types/tags'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'

// 导入子组件
import { TagStatsUpdateCard } from './tag-stats-update-card'
import { TagStatsCards } from './tag-stats-cards'
import { TagSearchAndFilter } from './tag-search-and-filter'
import { TagTable } from './tag-table'
import { TagPagination } from './tag-pagination'

/**
 * 标签管理组件
 */
function TagManagement() {
  const trpc = useTRPC()

  // 查询参数状态
  const [searchQuery, setSearchQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'translated' | 'untranslated'>('all')
  const [sortField, setSortField] = useState<TagManagementParams['sort']>('artworkCount')
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 翻译状态
  const [translatingTags, setTranslatingTags] = useState<Set<number>>(new Set())

  // 选中的标签（用于批量操作）
  const [selectedTags, setSelectedTags] = useState<Set<number>>(new Set())

  // 防抖搜索
  const debouncedSearchQuery = useDebounce(searchQuery, 500)

  // 搜索时重置到第一页
  useEffect(() => {
    if (currentPage !== 1) {
      setCurrentPage(1)
    }
  }, [debouncedSearchQuery, filter])

  // 获取标签列表
  const {
    data: queryData,
    isLoading,
    refetch
  } = useQuery(
    trpc.tag.management.queryOptions({
      page: currentPage,
      limit: pageSize,
      search: debouncedSearchQuery || undefined,
      filter,
      sort: sortField,
      order: sortOrder
    })
  )

  const tags = queryData?.data.tags || []
  const pagination = queryData?.data.pagination || {
    page: 1,
    limit: 20,
    totalCount: 0,
    totalPages: 0,
    hasNextPage: false,
    hasPrevPage: false
  }
  const stats = queryData?.data.stats || {
    totalTags: 0,
    translatedTags: 0,
    untranslatedTags: 0,
    translationRate: 0
  }

  // 处理标签选择
  const handleTagSelect = (tagId: number) => {
    const newSelected = new Set(selectedTags)
    if (newSelected.has(tagId)) {
      newSelected.delete(tagId)
    } else {
      newSelected.add(tagId)
    }
    setSelectedTags(newSelected)
  }

  // 全选/取消全选

  // 更新标签
  const handleTagUpdate = async (tagId: number, updates: { name?: string; name_zh?: string }) => {
    // TODO:
    toast.success('敬请期待')
  }

  return (
    <div className="p-6 space-y-6">
      {/* 页面标题 */}
      <div className="border-b border-neutral-200 pb-4">
        <h1 className="text-2xl font-bold text-neutral-900 flex items-center gap-2">
          <BarChart3 className="w-6 h-6" />
          标签管理
        </h1>
        <p className="text-neutral-600 mt-1">管理标签翻译，支持搜索、筛选和批量操作</p>
      </div>

      {/* 标签统计更新卡片 */}
      <TagStatsUpdateCard onUpdateStats={() => refetch()} />

      {/* 统计卡片 */}
      <TagStatsCards stats={stats} isLoading={isLoading} />

      {/* 搜索和筛选 */}
      <TagSearchAndFilter
        searchTerm={searchQuery}
        onSearchChange={setSearchQuery}
        translationFilter={filter}
        onTranslationFilterChange={setFilter}
        sortBy={sortField}
        onSortByChange={setSortField}
        sortOrder={sortOrder}
        onSortOrderChange={setSortOrder}
      />

      {/* 标签列表 */}
      <TagTable
        tags={tags}
        loading={isLoading}
        selectedTags={selectedTags}
        translatingTags={translatingTags}
        onTagSelect={handleTagSelect}
        onTagUpdate={handleTagUpdate}
      />

      {/* 分页 */}
      <TagPagination
        {...pagination}
        currentPage={currentPage}
        onPageChange={setCurrentPage}
        onPageSizeChange={setPageSize}
      />
    </div>
  )
}

export default TagManagement
