'use client'

import { useEffect } from 'react'
import { useInView } from 'react-intersection-observer'
import { Loader2, ImageIcon } from 'lucide-react'
import ArtworkCard from '@/components/artwork/ArtworkCard'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { EnhancedArtworksResponse } from '@/types'

interface InfiniteArtworkGridProps {
  initialData: EnhancedArtworksResponse & { nextCursor?: number }
}

export default function InfiniteArtworkGrid({ initialData }: InfiniteArtworkGridProps) {
  const trpc = useTRPC()
  const { ref, inView } = useInView()

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status, error } = useInfiniteQuery(
    trpc.artwork.queryRecommendPage.infiniteQueryOptions(
      { pageSize: 12 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialCursor: 1,
        initialData: {
          pages: [initialData],
          pageParams: [1]
        },
        staleTime: 5 * 60 * 1000, // 5 minutes
        gcTime: 10 * 60 * 1000 // 10 minutes
      }
    )
  )

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

  const allItems = data?.pages.flatMap((page) => page.items) || []

  if (status === 'error') {
    return (
      <div className="p-8 text-center text-red-500">
        加载失败: {error.message}
        <Button variant="outline" onClick={() => fetchNextPage()} className="ml-4">
          重试
        </Button>
      </div>
    )
  }

  if (allItems.length === 0) {
    return (
      <div className="p-12 text-center border rounded-lg bg-white shadow-sm">
        <ImageIcon size={52} className="text-gray-300 mx-auto mb-4" />
        <h3 className="text-lg font-medium text-gray-900 mb-2">暂无推荐作品</h3>
        <p className="text-gray-600">去浏览更多作品来获取推荐吧！</p>
      </div>
    )
  }

  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
        {allItems.map((artwork, index) => (
          <ArtworkCard 
            key={`${artwork.id}-${index}`} 
            artwork={artwork as any} 
            priority={index < 8} 
          />
        ))}
      </div>

      {/* Loading Indicator / Trigger */}
      <div ref={ref} className="flex justify-center py-8">
        {isFetchingNextPage ? (
          <div className="flex items-center gap-2 text-gray-500">
            <Loader2 className="h-6 w-6 animate-spin" />
            <span>加载更多精彩作品...</span>
          </div>
        ) : hasNextPage ? (
          <Button variant="ghost" onClick={() => fetchNextPage()}>
            加载更多
          </Button>
        ) : (
          <div className="text-gray-400 text-sm">没有更多推荐了</div>
        )}
      </div>
    </div>
  )
}
