'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation' // 导入 useSearchParams
import { useInfiniteQuery } from '@tanstack/react-query'
import { Artist, ArtistsQuery, PaginationResponseData } from '@/types'
import { ArtistCard } from '@/components/ui/ArtistCard'
import { client } from '@/lib/api'
import useInfiniteScroll from '@/hooks/useInfiniteScroll'
import ArtistsNavigation from './_components/ArtistsNavigation'
import type { ArtistResponseDto } from '@/schemas/artist.dto'

/**
 * 获取艺术家列表Hook (使用 useInfiniteQuery)
 */
function useArtistsInfinite(searchTerm: string, sortBy: ArtistsQuery['sortBy'], pageSize: number = 10) {
  return useInfiniteQuery({
    queryKey: ['artists', 'infinite', searchTerm, sortBy, pageSize],
    queryFn: async ({ pageParam = 1 }) => {
      const params = new URLSearchParams({
        page: pageParam.toString(),
        pageSize: pageSize.toString()
      })
      if (sortBy) {
        params.append('sortBy', sortBy)
      }
      if (searchTerm) {
        params.append('search', searchTerm)
      }
      return client<PaginationResponseData<ArtistResponseDto>>(`/api/artists?${params.toString()}`)
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) => {
      const nextPage = lastPage.pagination.page + 1
      const totalPages = Math.ceil(lastPage.pagination.total / lastPage.pagination.pageSize)
      return nextPage <= totalPages ? nextPage : undefined
    },
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000
  })
}

function ArtistsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // 1. 直接从 URL 读取状态
  const searchTerm = searchParams.get('search') || ''
  const sortBy = (searchParams.get('sortBy') as ArtistsQuery['sortBy']) || 'name_asc'

  // 2. 使用 useInfiniteQuery
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useArtistsInfinite(
    searchTerm,
    sortBy
  )

  // 3. 展平数据
  const allArtists = useMemo(() => {
    return data?.pages.flatMap((page) => page.data) || []
  }, [data])

  // 计算总数 (取第一页的 total 即可，因为每次返回的 total 应该是一样的)
  const totalCount = data?.pages[0]?.pagination.total || 0

  // 加载更多
  const handleLoadMore = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  // 无限滚动
  const { targetRef } = useInfiniteScroll({
    onLoadMore: handleLoadMore,
    hasMore: !!hasNextPage,
    loading: isFetchingNextPage || isLoading
  })

  // 处理艺术家点击
  const handleArtistClick = useCallback(
    (artist: Artist) => {
      router.push(`/artists/${artist.id}`)
    },
    [router]
  )

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="flex justify-center items-center h-64">
          <div className="text-lg text-gray-600 dark:text-gray-400">加载中...</div>
        </div>
      </div>
    )
  }

  if (isError) {
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

      {hasNextPage && (
        <div ref={targetRef} className="flex justify-center py-8">
          {(isFetchingNextPage || isLoading) && <div className="text-gray-600 dark:text-gray-400">加载更多...</div>}
        </div>
      )}

      {allArtists.length > 0 && (
        <div className="text-center mt-8 text-sm text-gray-500 dark:text-gray-500">
          已显示 {allArtists.length} / {totalCount} 位艺术家
        </div>
      )}
    </div>
  )
}

export default () => {
  return (
    <div className="min-h-screen bg-gray-50">
      <ArtistsNavigation></ArtistsNavigation>
      <main className="max-w-7xl mx-auto py-8 px-4 sm:px-6 lg:px-8">
        <ArtistsPage></ArtistsPage>
      </main>
    </div>
  )
}
