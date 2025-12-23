'use client'

import React, { useState, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation' // 导入 useSearchParams
import { useQuery } from '@tanstack/react-query'
import { Artist, ArtistsQuery } from '@/types'
import { ArtistCard } from '@/components/ui/ArtistCard'
import { client } from '@/lib/api'
import useInfiniteScroll from '@/hooks/useInfiniteScroll'

// ============================================================================
// Types
// ============================================================================

interface ArtistsResponse {
  items: Artist[]
  total: number
  page: number
  pageSize: number
}

/**
 * 获取艺术家列表Hook
 * queryKey 现在依赖于从外部传入的 searchTerm 和 sortBy
 */
function useArtists(searchTerm: string, sortBy: ArtistsQuery['sortBy'], page: number = 1, pageSize: number = 20) {
  return useQuery({
    queryKey: ['artists', searchTerm, sortBy, page, pageSize], // queryKey包含了筛选参数
    queryFn: async (): Promise<ArtistsResponse> => {
      const params = new URLSearchParams({
        page: page.toString(),
        pageSize: pageSize.toString()
      })
      if (sortBy) {
        params.append('sortBy', sortBy)
      }
      if (searchTerm) {
        params.append('search', searchTerm)
      }
      return client<ArtistsResponse>(`/api/artists?${params.toString()}`)
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

// ============================================================================
// Components
// ============================================================================

export default function ArtistsPage() {
  const router = useRouter()
  const searchParams = useSearchParams() // 1. 获取 URL 查询参数对象

  // 2. 直接从 URL 读取状态，不再需要本地的 useState 来管理它们
  const searchTerm = searchParams.get('search') || ''
  const sortBy = (searchParams.get('sortBy') as ArtistsQuery['sortBy']) || 'name_asc'

  // 页面和数据列表的状态仍然保留在组件内部
  const [currentPage, setCurrentPage] = useState(1)
  const [allArtists, setAllArtists] = useState<Artist[]>([])
  const [hasMore, setHasMore] = useState(true)

  // 3. 将从 URL 获取的参数直接传入 useArtists hook。
  // 当 URL 变化时，searchTerm 或 sortBy 会变化，
  // 导致 useQuery 的 queryKey 变化，从而自动重新获取数据。
  const { data, isLoading, error } = useArtists(searchTerm, sortBy, currentPage)

  // 处理数据加载和合并
  React.useEffect(() => {
    if (data) {
      // 如果是第一页，则直接替换数据；否则追加数据
      if (currentPage === 1) {
        setAllArtists(data.items)
      } else {
        setAllArtists((prev) => [...prev, ...data.items])
      }
      // 计算是否还有更多数据
      const hasMoreData = currentPage * data.pageSize < data.total
      setHasMore(hasMoreData)
    }
  }, [data, currentPage])

  // 4. 当 URL 中的筛选条件变化时，重置分页和艺术家列表
  React.useEffect(() => {
    setCurrentPage(1)
    setAllArtists([])
    // 滚动到页面顶部
    window.scrollTo(0, 0)
  }, [searchTerm, sortBy]) // 依赖项是来自 URL 的参数

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

  if (isLoading && currentPage === 1) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-gray-600 dark:text-gray-400">加载中...</div>
        </div>
      </div>
    )
  }

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
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">艺术家</h1>
        <p className="text-gray-600 dark:text-gray-400">发现和探索才华横溢的艺术家们</p>
      </div>

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
              {searchTerm ? '未找到匹配的艺术家' : '暂无艺术家'}
            </div>
            {searchTerm && <div className="text-sm text-gray-500 dark:text-gray-500">尝试使用不同的关键词搜索</div>}
          </div>
        </div>
      )}

      {hasMore && (
        <div ref={targetRef} className="flex justify-center py-8">
          {isLoading && <div className="text-gray-600 dark:text-gray-400">加载更多...</div>}
        </div>
      )}

      {data && allArtists.length > 0 && (
        <div className="text-center mt-8 text-sm text-gray-500 dark:text-gray-500">
          已显示 {allArtists.length} / {data.total} 位艺术家
        </div>
      )}
    </div>
  )
}
