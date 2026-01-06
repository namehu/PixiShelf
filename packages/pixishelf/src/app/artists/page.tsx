'use client'

import { useCallback, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArtistsQuery } from '@/types'
import useInfiniteScroll from '@/hooks/useInfiniteScroll'
import ArtistsNavigation from './_components/ArtistsNavigation'
import { ArtistCard } from './_components/ArtistCard'
import { Users, Search } from 'lucide-react'
import { useTRPC } from '@/lib/trpc'

function ArtistsPage() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // 1. 直接从 URL 读取状态
  const searchTerm = searchParams.get('search') || ''
  const sortBy = (searchParams.get('sortBy') as ArtistsQuery['sortBy']) || 'name_asc'

  const trpc = useTRPC()

  // 2. 使用 useInfiniteQuery
  const { data, isLoading, isError, fetchNextPage, hasNextPage, isFetchingNextPage } = useInfiniteQuery(
    trpc.artist.queryPage.infiniteQueryOptions(
      { search: searchTerm, sortBy },
      {
        getNextPageParam: ({ nextCursor }) => nextCursor,
        initialCursor: 1,
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000
      }
    )
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

  if (isLoading) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {[...Array(8)].map((_, i) => (
            <div key={i} className="h-48 bg-gray-100 dark:bg-gray-800 rounded-xl animate-pulse" />
          ))}
        </div>
      </div>
    )
  }

  if (isError) {
    return (
      <div className="container mx-auto px-4 py-16 text-center">
        <div className="bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400 p-8 rounded-xl inline-block">
          <p className="text-lg font-medium">加载失败，请稍后重试</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-6">
      <div className="flex items-center gap-3 mb-8">
        <div className="p-2 bg-primary/10 rounded-lg">
          <Users className="w-6 h-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">推荐画师</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">发现 {totalCount} 位才华横溢的创作者</p>
        </div>
      </div>

      {allArtists.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {allArtists.map((artist) => (
            <div key={artist.id} className="transform transition-transform hover:-translate-y-1 duration-200">
              <ArtistCard artist={artist} onClick={() => router.push(`/artists/${artist.id}`)} />
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col justify-center items-center h-96 bg-gray-50 dark:bg-gray-800/50 rounded-2xl border border-dashed border-gray-200 dark:border-gray-700">
          <div className="bg-white dark:bg-gray-800 p-4 rounded-full shadow-sm mb-4">
            <Search className="w-8 h-8 text-gray-400" />
          </div>
          <div className="text-lg font-medium text-gray-900 dark:text-gray-200 mb-2">
            {searchTerm ? '未找到匹配的艺术家' : '暂无艺术家'}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs text-center">
            {searchTerm ? '换个关键词试试看？' : '稍后再来看看吧'}
          </p>
        </div>
      )}

      {hasNextPage && (
        <div ref={targetRef} className="flex justify-center py-12">
          {(isFetchingNextPage || isLoading) && (
            <div className="flex items-center gap-2 text-primary">
              <div className="w-2 h-2 rounded-full bg-current animate-bounce" />
              <div className="w-2 h-2 rounded-full bg-current animate-bounce [animation-delay:0.2s]" />
              <div className="w-2 h-2 rounded-full bg-current animate-bounce [animation-delay:0.4s]" />
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function Page() {
  return (
    <div className="min-h-screen bg-gray-50/50 dark:bg-gray-950">
      <ArtistsNavigation />
      <main className="max-w-[1600px] mx-auto">
        <ArtistsPage />
      </main>
    </div>
  )
}
