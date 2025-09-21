'use client'

import React, { useState, useEffect, useCallback } from 'react'
import { Search, Filter, RefreshCw, Shuffle, TrendingUp } from 'lucide-react'
import { TagCard } from './TagCard'
import { TagSquareProps, TagSearchParams, PopularTagsParams, RandomTagsParams } from '@/types/tags'
import { cn } from '@/lib/utils'
import { Tag } from '@/types/core'

/**
 * 标签广场组件
 * 提供标签浏览、搜索、筛选功能
 */
export function TagSquare({
  initialTags = [],
  pageSize = 20,
  showSearch = true,
  showFilters = true,
  cardMode = 'compact',
  className
}: TagSquareProps) {
  const [tags, setTags] = useState<Tag[]>(initialTags)
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [currentMode, setCurrentMode] = useState<'popular' | 'search' | 'random'>('popular')
  const [sortBy, setSortBy] = useState<'artworkCount' | 'name' | 'createdAt'>('artworkCount')
  const [sortOrder, setSortOrder] = useState<'desc' | 'asc'>('desc')
  const [page, setPage] = useState(1)
  const [hasMore, setHasMore] = useState(true)

  // 获取热门标签
  const fetchPopularTags = useCallback(
    async (params: PopularTagsParams = {}) => {
      setLoading(true)
      try {
        const queryParams = new URLSearchParams({
          limit: (params.limit || pageSize).toString(),
          minCount: (params.minCount || 1).toString()
        })

        const response = await fetch(`/api/v1/tags/popular?${queryParams}`)
        const data = await response.json()

        if (data.success) {
          setTags(data.data.tags)
          setHasMore(data.data.tags.length >= pageSize)
        } else {
          console.error('获取热门标签失败:', data.error)
        }
      } catch (error) {
        console.error('获取热门标签错误:', error)
      } finally {
        setLoading(false)
      }
    },
    [pageSize]
  )

  // 搜索标签
  const searchTags = useCallback(
    async (params: TagSearchParams) => {
      setLoading(true)
      try {
        const queryParams = new URLSearchParams({
          q: params.q,
          page: (params.page || 1).toString(),
          limit: (params.limit || pageSize).toString(),
          sort: params.sort || sortBy,
          order: params.order || sortOrder
        })

        const response = await fetch(`/api/v1/tags/search?${queryParams}`)
        const data = await response.json()

        if (data.success) {
          if (params.page === 1) {
            setTags(data.data.tags)
          } else {
            setTags((prev) => [...prev, ...data.data.tags])
          }
          setHasMore(data.data.pagination.hasNextPage)
        } else {
          console.error('搜索标签失败:', data.error)
        }
      } catch (error) {
        console.error('搜索标签错误:', error)
      } finally {
        setLoading(false)
      }
    },
    [pageSize, sortBy, sortOrder]
  )

  // 获取随机标签
  const fetchRandomTags = useCallback(
    async (params: RandomTagsParams = {}) => {
      setLoading(true)
      try {
        const queryParams = new URLSearchParams({
          count: (params.count || pageSize).toString(),
          minCount: (params.minCount || 0).toString(),
          excludeEmpty: (params.excludeEmpty || false).toString()
        })

        const response = await fetch(`/api/v1/tags/random?${queryParams}`)
        const data = await response.json()

        if (data.success) {
          setTags(data.data.tags)
          setHasMore(false) // 随机标签不支持分页
        } else {
          console.error('获取随机标签失败:', data.error)
        }
      } catch (error) {
        console.error('获取随机标签错误:', error)
      } finally {
        setLoading(false)
      }
    },
    [pageSize]
  )

  // 处理搜索
  const handleSearch = useCallback(
    (query: string) => {
      setSearchQuery(query)
      setPage(1)
      if (query.trim()) {
        setCurrentMode('search')
        searchTags({ q: query, page: 1 })
      } else {
        setCurrentMode('popular')
        fetchPopularTags()
      }
    },
    [searchTags, fetchPopularTags]
  )

  // 处理排序变更
  const handleSortChange = useCallback(
    (newSortBy: typeof sortBy, newSortOrder: typeof sortOrder) => {
      setSortBy(newSortBy)
      setSortOrder(newSortOrder)
      setPage(1)

      if (currentMode === 'search' && searchQuery) {
        searchTags({ q: searchQuery, page: 1, sort: newSortBy, order: newSortOrder })
      } else if (currentMode === 'popular') {
        fetchPopularTags()
      }
    },
    [currentMode, searchQuery, searchTags, fetchPopularTags]
  )

  // 加载更多
  const loadMore = useCallback(() => {
    if (loading || !hasMore) return

    const nextPage = page + 1
    setPage(nextPage)

    if (currentMode === 'search' && searchQuery) {
      searchTags({ q: searchQuery, page: nextPage })
    }
  }, [loading, hasMore, page, currentMode, searchQuery, searchTags])

  // 刷新数据
  const refresh = useCallback(() => {
    setPage(1)
    switch (currentMode) {
      case 'search':
        if (searchQuery) {
          searchTags({ q: searchQuery, page: 1 })
        }
        break
      case 'random':
        fetchRandomTags()
        break
      case 'popular':
      default:
        fetchPopularTags()
        break
    }
  }, [currentMode, searchQuery, searchTags, fetchRandomTags, fetchPopularTags])

  // 初始化加载
  useEffect(() => {
    if (initialTags.length === 0) {
      fetchPopularTags()
    }
  }, [fetchPopularTags, initialTags.length])

  // 标签点击处理
  const handleTagClick = useCallback((tag: Tag) => {
    // 这里可以添加导航到标签详情页或相关作品页的逻辑
    console.log('点击标签:', tag)
  }, [])

  return (
    <div className={cn('w-full space-y-6', className)}>
      {/* 头部控制区 */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-2xl font-bold text-gray-900">标签广场</h2>
          <span className="text-sm text-gray-500">({tags.length} 个标签)</span>
        </div>

        <div className="flex items-center gap-2">
          {/* 模式切换按钮 */}
          <div className="flex items-center gap-1 p-1 bg-gray-100 rounded-lg">
            <button
              onClick={() => {
                setCurrentMode('popular')
                setPage(1)
                fetchPopularTags()
              }}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                currentMode === 'popular' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <TrendingUp className="w-4 h-4 mr-1" />
              热门
            </button>
            <button
              onClick={() => {
                setCurrentMode('random')
                setPage(1)
                fetchRandomTags()
              }}
              className={cn(
                'px-3 py-1.5 text-sm font-medium rounded-md transition-colors',
                currentMode === 'random' ? 'bg-white text-blue-600 shadow-sm' : 'text-gray-600 hover:text-gray-900'
              )}
            >
              <Shuffle className="w-4 h-4 mr-1" />
              随机
            </button>
          </div>

          {/* 刷新按钮 */}
          <button
            onClick={refresh}
            disabled={loading}
            className="p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors disabled:opacity-50"
            title="刷新"
          >
            <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* 搜索和筛选区 */}
      {(showSearch || showFilters) && (
        <div className="flex flex-col sm:flex-row gap-4">
          {/* 搜索框 */}
          {showSearch && (
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索标签..."
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          )}

          {/* 排序筛选 */}
          {showFilters && (
            <div className="flex items-center gap-2">
              <Filter className="w-4 h-4 text-gray-400" />
              <select
                value={`${sortBy}-${sortOrder}`}
                onChange={(e) => {
                  const [newSortBy, newSortOrder] = e.target.value.split('-') as [typeof sortBy, typeof sortOrder]
                  handleSortChange(newSortBy, newSortOrder)
                }}
                className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="artworkCount-desc">作品数量 ↓</option>
                <option value="artworkCount-asc">作品数量 ↑</option>
                <option value="name-asc">名称 A-Z</option>
                <option value="name-desc">名称 Z-A</option>
                <option value="createdAt-desc">最新创建</option>
                <option value="createdAt-asc">最早创建</option>
              </select>
            </div>
          )}
        </div>
      )}

      {/* 标签网格 */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {tags.map((tag) => (
          <TagCard key={tag.id} tag={tag} mode={cardMode} onClick={handleTagClick} />
        ))}
      </div>

      {/* 加载状态 */}
      {loading && (
        <div className="flex items-center justify-center py-8">
          <RefreshCw className="w-6 h-6 animate-spin text-blue-600" />
          <span className="ml-2 text-gray-600">加载中...</span>
        </div>
      )}

      {/* 加载更多按钮 */}
      {!loading && hasMore && currentMode === 'search' && (
        <div className="flex justify-center">
          <button
            onClick={loadMore}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            加载更多
          </button>
        </div>
      )}

      {/* 空状态 */}
      {!loading && tags.length === 0 && (
        <div className="text-center py-12">
          <div className="text-gray-400 mb-2">
            <Search className="w-12 h-12 mx-auto" />
          </div>
          <h3 className="text-lg font-medium text-gray-900 mb-1">没有找到标签</h3>
          <p className="text-gray-500">{searchQuery ? '尝试使用其他关键词搜索' : '暂无可用标签'}</p>
        </div>
      )}
    </div>
  )
}

// 导出默认组件
export default TagSquare
