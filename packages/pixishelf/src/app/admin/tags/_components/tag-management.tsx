'use client'

import { useState, useEffect } from 'react'
import { useDebounce } from '@/hooks/useDebounce'
import { toast } from 'sonner'
import { BarChart3, RefreshCw } from 'lucide-react'
import type { TagManagementParams } from '@/types/tags'
import { useQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { updateTagStatsAction } from '@/actions/tag-action'

// 导入子组件
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
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)

  // 标签统计更新状态
  const [isUpdatingStats, setIsUpdatingStats] = useState(false)

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
      sort: sortField
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

  // 手动更新标签统计
  const handleUpdateStats = async () => {
    try {
      setIsUpdatingStats(true)
      const result = await updateTagStatsAction()

      if (result.success) {
        toast.success('标签统计更新成功')
        // 刷新页面数据以显示最新统计
        refetch()
      } else {
        throw new Error(result.message || '更新失败')
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : '标签统计更新失败'
      toast.error(errorMessage)
    } finally {
      setIsUpdatingStats(false)
    }
  }

  // 全选/取消全选

  // 更新标签
  const handleTagUpdate = async (tagId: number, updates: { name?: string; name_zh?: string }) => {
    // TODO:
    toast.success('敬请期待')
  }

  return (
    <div className="p-4 md:p-6 space-y-4 md:space-y-6">
      {/* 页面标题 */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 border-b border-neutral-200 pb-4">
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-neutral-900 flex items-center gap-2">
            <BarChart3 className="w-5 h-5 md:w-6 md:h-6" />
            标签管理
          </h1>
          <p className="text-sm md:text-base text-neutral-600 mt-1">管理标签翻译，支持搜索、筛选和批量操作</p>
        </div>
        <Button
          variant="outline"
          onClick={handleUpdateStats}
          disabled={isUpdatingStats}
          className="w-full md:w-auto flex items-center justify-center gap-2"
        >
          <RefreshCw className={`w-4 h-4 ${isUpdatingStats ? 'animate-spin' : ''}`} />
          {isUpdatingStats ? '更新中...' : '更新统计'}
        </Button>
      </div>

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
      />

      {/* 标签列表 */}
      <TagTable tags={tags} loading={isLoading} onTagUpdate={handleTagUpdate} />

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
