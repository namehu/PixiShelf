'use client'

import React, { useState, useCallback, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { useQuery } from '@tanstack/react-query'
import { Artist, SortOption } from '@pixishelf/shared'
import { useAuth } from '@/components'
import { Input, SortControl, ArtistCard } from '@/components/ui'
import { apiJson } from '@/lib/api'
import useInfiniteScroll from '@/hooks/useInfiniteScroll'
import useDebounce from '@/hooks/useDebounce'

// ============================================================================
// Types
// ============================================================================

interface ArtistsResponse {
  items: Artist[]
  total: number
  page: number
  pageSize: number
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * 获取艺术家列表Hook
 */
function useArtists(searchTerm: string, sortBy: SortOption, page: number = 1, pageSize: number = 20) {
  return useQuery({
    queryKey: ['artists', searchTerm, sortBy, page, pageSize],
    queryFn: async (): Promise<ArtistsResponse> => {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString()
      })

      // 转换排序格式以匹配 API
      const sortByValue = `${sortBy.value}_${sortBy.order}`
      params.append('sortBy', sortByValue)

      if (searchTerm) {
        params.append('search', searchTerm)
      }

      return apiJson<ArtistsResponse>(`/api/v1/artists?${params}`)
    },
    staleTime: 5 * 60 * 1000, // 5分钟
    gcTime: 10 * 60 * 1000 // 10分钟
  })
}

// ============================================================================
// Components
// ============================================================================

export default function ArtistsPage() {
  const router = useRouter()
  const { user } = useAuth()

  // 状态管理
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState<SortOption>({
    value: 'createdAt',
    label: '创建时间',
    order: 'desc'
  })
  const [currentPage, setCurrentPage] = useState(1)
  const [allArtists, setAllArtists] = useState<Artist[]>([])
  const [hasMore, setHasMore] = useState(true)

  // 防抖搜索
  const debouncedSearchTerm = useDebounce(searchTerm, 300)

  // 查询数据
  const { data, isLoading, error, refetch } = useArtists(debouncedSearchTerm, sortBy, currentPage)

  // 排序选项
  const sortOptions: SortOption[] = useMemo(() => [
    { value: 'name', label: '名称', order: 'asc' },
    { value: 'name', label: '名称', order: 'desc' },
    { value: 'artworks', label: '作品数量', order: 'desc' },
    { value: 'artworks', label: '作品数量', order: 'asc' }
  ], [])

  // 处理数据更新
  React.useEffect(() => {
    if (data) {
      if (currentPage === 1) {
        setAllArtists(data.items)
      } else {
        setAllArtists(prev => [...prev, ...data.items])
      }
      // 计算是否还有更多数据
      const hasMoreData = currentPage * data.pageSize < data.total
      setHasMore(hasMoreData)
    }
  }, [data, currentPage])

  // 重置搜索和排序时回到第一页
  React.useEffect(() => {
    setCurrentPage(1)
    setAllArtists([])
  }, [debouncedSearchTerm, sortBy])

  // 加载更多
  const handleLoadMore = useCallback(() => {
    if (hasMore && !isLoading) {
      setCurrentPage((prev) => prev + 1)
    }
  }, [hasMore, isLoading])

  // 无限滚动
  const { targetRef } = useInfiniteScroll({
    onLoadMore: handleLoadMore,
    hasMore,
    loading: isLoading
  })

  // 处理艺术家点击
  const handleArtistClick = useCallback(
    (artist: Artist) => {
      router.push(`/artists/${artist.id}`)
    },
    [router]
  )

  // 处理搜索
  const handleSearch = useCallback((value: string) => {
    setSearchTerm(value)
  }, [])

  // 处理排序
  const handleSort = useCallback((option: SortOption) => {
    setSortBy(option)
  }, [])

  // 渲染加载状态
  if (isLoading && currentPage === 1) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-gray-600 dark:text-gray-400">加载中...</div>
        </div>
      </div>
    )
  }

  // 渲染错误状态
  if (error) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-red-600 dark:text-red-400">加载失败，请稍后重试</div>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">艺术家</h1>
        <p className="text-gray-600 dark:text-gray-400">发现和探索才华横溢的艺术家们</p>
      </div>

      {/* 搜索和排序 */}
      <div className="flex flex-col sm:flex-row gap-4 mb-8">
        <div className="flex-1">
          <Input
            type="text"
            placeholder="搜索艺术家..."
            value={searchTerm}
            onChange={(e) => handleSearch(e.target.value)}
            className="w-full"
          />
        </div>
        <div className="sm:w-auto">
          <SortControl options={sortOptions} value={sortBy} onChange={handleSort} />
        </div>
      </div>

      {/* 艺术家列表 */}
      {allArtists.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {allArtists.map((artist) => (
            <ArtistCard key={artist.id} artist={artist} onClick={() => handleArtistClick(artist)} />
          ))}
        </div>
      ) : (
        <div className="flex justify-center items-center h-64">
          <div className="text-center">
            <div className="text-lg text-gray-600 dark:text-gray-400 mb-2">
              {debouncedSearchTerm ? '未找到匹配的艺术家' : '暂无艺术家'}
            </div>
            {debouncedSearchTerm && (
              <div className="text-sm text-gray-500 dark:text-gray-500">尝试使用不同的关键词搜索</div>
            )}
          </div>
        </div>
      )}

      {/* 加载更多触发器 */}
      {hasMore && (
        <div ref={targetRef} className="flex justify-center py-8">
          {isLoading && <div className="text-gray-600 dark:text-gray-400">加载更多...</div>}
        </div>
      )}

      {/* 总数显示 */}
      {data && allArtists.length > 0 && (
        <div className="text-center mt-8 text-sm text-gray-500 dark:text-gray-500">
          已显示 {allArtists.length} / {data.total} 位艺术家
        </div>
      )}
    </div>
  )
}
