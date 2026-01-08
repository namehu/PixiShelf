'use client'

import React, { useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { useInfiniteQuery } from '@tanstack/react-query'
import { SortOption } from '@/types'
import { SortControl } from '@/components/ui/SortControl'
import ClientImage from '@/components/client-image'
import HeadInfo from './HeadInfo'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import { useTRPC } from '@/lib/trpc'
import { useInView } from 'react-intersection-observer'
import { Loader2 } from 'lucide-react'

/**
 * 艺术家详情页面
 */
export default function ArtistDetailPage({ artist, id }: { artist: ArtistResponseDto; id: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const trpc = useTRPC()

  const pageSize = 24
  const sortBy = (searchParams.get('sortBy') as SortOption) || 'source_date_desc'

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading: artworksLoading,
    isError: artworksError
  } = useInfiniteQuery(
    trpc.artwork.list.infiniteQueryOptions(
      {
        artistId: parseInt(id),
        pageSize,
        sortBy
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialCursor: 1
      }
    )
  )

  const { ref: loadMoreRef, inView } = useInView()

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

  // Flatten data
  const artworks = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) || []
  }, [data])

  const total = data?.pages[0]?.total || 0

  // 处理排序变化
  const handleSortChange = (newSortBy: SortOption) => {
    const newParams = new URLSearchParams(searchParams.toString())
    if (newSortBy === 'source_date_desc') {
      newParams.delete('sortBy')
    } else {
      newParams.set('sortBy', newSortBy)
    }
    // 移除 page 参数
    newParams.delete('page')
    router.push(`/artists/${id}?${newParams.toString()}`)
  }

  return (
    <div className="relative">
      <HeadInfo artist={artist} />
      {/* 作品列表部分 */}
      <div className="space-y-6 px-4 my-4">
        {/* 作品列表标题和排序 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">作品集</h2>
            <p className="text-gray-600 mt-1">{artworksLoading ? '加载中...' : `共 ${total} 件作品`}</p>
          </div>

          <SortControl value={sortBy} onChange={handleSortChange} size="md" />
        </div>

        {/* 作品网格 */}
        {artworksLoading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="bg-white rounded-lg shadow overflow-hidden animate-pulse">
                <div className="aspect-[3/4] bg-gray-200" />
                <div className="p-4 space-y-2">
                  <div className="h-4 bg-gray-200 rounded" />
                  <div className="h-3 bg-gray-200 rounded w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : artworksError ? (
          <div className="text-center py-12">
            <p className="text-gray-600">加载作品时出错，请稍后重试。</p>
          </div>
        ) : artworks.length === 0 ? (
          <div className="text-center py-12">
            <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zM21 5a2 2 0 00-2-2h-4a2 2 0 00-2 2v12a4 4 0 004 4h4a2 2 0 002-2V5z"
              />
            </svg>
            <h3 className="text-lg font-medium text-gray-900 mb-2">暂无作品</h3>
            <p className="text-gray-600">该艺术家还没有上传任何作品</p>
          </div>
        ) : (
          <>
            {/* 作品网格 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              {artworks.map((aw) => {
                const { id, title, images } = aw
                const cover = images?.[0]
                const src = cover ? cover.path : null
                const imageCount = images?.filter((img) => img.mediaType === 'image').length || 0
                const videoFiles = images?.filter((img) => img.mediaType === 'video') || []
                const totalMediaSize = videoFiles.reduce((sum, file) => sum + (file.size || 0), 0)

                return (
                  <Link key={id} href={`/artworks/${id}`} className="block animate-fade-in">
                    <div className="bg-white rounded-lg shadow overflow-hidden hover:shadow-lg transition-shadow">
                      {/* 媒体预览 */}
                      <div className="relative aspect-[3/4] w-full overflow-hidden bg-gray-100">
                        {src ? (
                          <ClientImage src={src} alt={title} className="h-full w-full object-cover" loading="lazy" />
                        ) : (
                          <div className="h-full w-full bg-gray-200 flex items-center justify-center">
                            <svg
                              className="w-8 h-8 text-gray-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                          </div>
                        )}

                        {/* 媒体数量标识 */}
                        <div className="absolute top-3 right-3 flex flex-col gap-1">
                          {imageCount > 1 && (
                            <div className="bg-black/70 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                />
                              </svg>
                              {imageCount}
                            </div>
                          )}
                          {totalMediaSize > 0 && (
                            <div className="bg-red-600/80 backdrop-blur-sm text-white px-2 py-1 rounded-lg text-xs font-medium flex items-center gap-1">
                              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                                />
                              </svg>
                              {(totalMediaSize / (1024 * 1024)).toFixed(1)}MB
                            </div>
                          )}
                        </div>
                      </div>

                      {/* 内容 */}
                      <div className="p-4 space-y-2">
                        <h3 className="font-medium text-gray-900 truncate" title={title}>
                          {title}
                        </h3>
                      </div>
                    </div>
                  </Link>
                )
              })}
            </div>

            {/* 加载更多 */}
            <div ref={loadMoreRef} className="flex justify-center py-8">
              {isFetchingNextPage ? (
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              ) : hasNextPage ? (
                 <span className="text-gray-400 text-sm">向下滚动加载更多</span>
              ) : (
                <span className="text-gray-400 text-sm">没有更多作品了</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
