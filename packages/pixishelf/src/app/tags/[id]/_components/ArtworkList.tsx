'use client'

import { useState, useEffect, useMemo } from 'react'
import { Hash } from 'lucide-react'
import { useInView } from 'react-intersection-observer'
import { Artwork } from '@/types/core'
import { ArtworkCard } from '@/components/ui/ArtworkCard'
import { Skeleton } from '@/components/ui/skeleton'
import { useTRPC } from '@/lib/trpc'
import { useInfiniteQuery } from '@tanstack/react-query'

interface ArtworkListProps {
  tagId: string
}

export function ArtworkList({ tagId }: ArtworkListProps) {
  const trpc = useTRPC()
  const pageSize = 20

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError, refetch } = useInfiniteQuery(
    trpc.artwork.list.infiniteQueryOptions(
      {
        tagId: parseInt(tagId),
        pageSize
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialCursor: 1
      }
    )
  )

  const artworks = useMemo(() => data?.pages.flatMap((page) => page.items) || [], [data])
  const total = data?.pages[0]?.total || 0

  // 滚动监听
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0,
    rootMargin: '200px'
  })

  // 触发下一页
  useEffect(() => {
    if (inView && !isLoading && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage])

  const hasMore = hasNextPage

  return (
    <div className="w-full">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl font-bold text-slate-800 flex items-center gap-2">
          作品列表
          <span className="text-sm font-normal text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            {total ? `${total}+` : '0'}
          </span>
        </h2>
      </div>

      <div className="min-h-[200px]">
        {artworks.length === 0 && !isLoading && !isError ? (
          <div className="text-center py-20 bg-white rounded-3xl border border-slate-100 shadow-sm">
            <div className="text-slate-300 mb-4 flex justify-center">
              <Hash className="w-16 h-16" />
            </div>
            <h3 className="text-lg font-bold text-slate-900 mb-2">暂无作品</h3>
            <p className="text-slate-500">该标签下还没有任何作品</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
            {artworks.map((artwork) => (
              <ArtworkCard key={`${artwork.id}-${artwork.updatedAt}`} artwork={artwork} showArtist={true} />
            ))}

            {/* Loading Skeletons */}
            {(isLoading || isFetchingNextPage) &&
              Array.from({ length: 10 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="space-y-2">
                  <Skeleton className="aspect-[3/4] w-full rounded-xl bg-slate-200" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-3/4 bg-slate-200" />
                    <Skeleton className="h-3 w-1/2 bg-slate-200" />
                  </div>
                </div>
              ))}
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-20 text-red-500">
            <p className="mb-2">加载失败</p>
            <button
              onClick={() => refetch()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              重试
            </button>
          </div>
        )}

        {/* 底部触发器 */}
        <div
          ref={loadMoreRef}
          className="h-20 w-full flex items-center justify-center mt-8 opacity-0 pointer-events-none"
        />

        {!hasMore && artworks.length > 0 && (
          <div className="text-center py-8 text-xs text-slate-400 uppercase tracking-widest border-t border-slate-100 mt-8">
            — End of Collection —
          </div>
        )}
      </div>
    </div>
  )
}
