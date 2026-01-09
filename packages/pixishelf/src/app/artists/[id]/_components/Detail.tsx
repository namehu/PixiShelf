'use client'

import { useEffect, useMemo, useRef, useState, useLayoutEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useInfiniteQuery } from '@tanstack/react-query'
import { SortOption } from '@/types'
import { SortControl } from '@/components/ui/SortControl'
import HeadInfo from './HeadInfo'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import { useTRPC } from '@/lib/trpc'
import { useInView } from 'react-intersection-observer'
import { Loader2, Filter } from 'lucide-react'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useColumns } from '@/hooks/use-columns'
import ArtworkCard from '@/components/artwork/ArtworkCard'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

export default function ArtistDetailPage({ artist, id }: { artist: ArtistResponseDto; id: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const trpc = useTRPC()
  const containerRef = useRef<HTMLDivElement>(null)
  const virtualListRef = useRef<HTMLDivElement>(null)
  const columns = useColumns()

  const [containerWidth, setContainerWidth] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [offsetTop, setOffsetTop] = useState(0)

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
        artistId: id,
        pageSize,
        sortBy
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialCursor: 1
      }
    )
  )

  const { ref: loadMoreRef, inView } = useInView({
    rootMargin: '200px'
  })

  // Flatten data
  const allItems = useMemo(() => {
    return data?.pages.flatMap((page) => page.items) || []
  }, [data])

  const total = data?.pages[0]?.total || 0
  const rowCount = Math.ceil(allItems.length / columns)

  // 监听容器宽度
  useLayoutEffect(() => {
    if (!containerRef.current) return

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      resizeObserver.disconnect()
    }
  }, [])

  // 计算偏移量
  useLayoutEffect(() => {
    if (virtualListRef.current) {
      const rect = virtualListRef.current.getBoundingClientRect()
      const scrollTop = window.scrollY || document.documentElement.scrollTop
      setOffsetTop(rect.top + scrollTop)
    }
  }, [])

  const estimateSize = useCallback(() => {
    const effectiveWidth = containerWidth
    const safeColumns = columns > 0 ? columns : 1
    // gap-3 = 12px (InfiniteArtworkList uses gap-3, but original Detail used gap-6 = 24px)
    // We should probably stick to gap-3 to match InfiniteArtworkList as requested, or adjust.
    // InfiniteArtworkList: gap-3
    // Detail (original): gap-6
    // User asked to "adopt layout same as artwork list", so I will use gap-3 (12px).
    const gapTotal = (safeColumns - 1) * 12
    const cardWidth = (effectiveWidth - gapTotal) / safeColumns
    // 假设卡片宽高比约为 3:4 (0.75)，加上底部信息高度约 60px
    return cardWidth * 1.33 + 60
  }, [containerWidth, columns])

  const rowVirtualizer = useWindowVirtualizer({
    useFlushSync: false,
    count: rowCount,
    estimateSize,
    scrollMargin: offsetTop,
    overscan: 5,
    enabled: !!containerWidth
  })

  // 生成唯一的存储 key，基于当前的筛选条件
  const storageKey = `artist-detail-scroll-${id}-${sortBy}`

  // 1. 处理滚动恢复
  useLayoutEffect(() => {
    // 禁用浏览器的默认滚动恢复，改由我们手动控制
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    const savedPosition = sessionStorage.getItem(storageKey)

    // 如果没有保存的位置，直接标记为准备就绪
    if (!savedPosition) {
      setIsReady(true)
      return
    }

    // 如果有保存位置，等待容器宽度和数据准备好
    if (savedPosition && containerWidth > 0 && allItems.length > 0) {
      window.scrollTo(0, parseInt(savedPosition, 10))

      requestAnimationFrame(() => {
        setIsReady(true)
      })
    }
  }, [containerWidth, allItems.length, storageKey])

  // 2. 保存滚动位置
  useEffect(() => {
    const handleScroll = () => {
      // 使用 requestAnimationFrame 节流
      requestAnimationFrame(() => {
        sessionStorage.setItem(storageKey, window.scrollY.toString())
      })
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [storageKey])

  // 加载更多
  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage && !artworksLoading && containerWidth > 0) {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage, artworksLoading, containerWidth])

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
            <p className="text-gray-600 mt-1">{artworksLoading && !data ? '加载中...' : `共 ${total} 件作品`}</p>
          </div>

          <SortControl value={sortBy} onChange={handleSortChange} size="md" />
        </div>

        {/* 错误状态 */}
        {artworksError && (
          <div className="flex flex-col items-center justify-center py-20 text-red-500">
            <p className="mb-2">加载失败</p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          </div>
        )}

        {/* 空状态 */}
        {!artworksLoading && allItems.length === 0 && !artworksError && (
          <div className="flex flex-col items-center justify-center py-32 text-neutral-400">
            <Filter className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium">该艺术家还没有上传任何作品</p>
          </div>
        )}

        <div
          ref={containerRef}
          className={`space-y-8 min-h-[50vh] transition-opacity duration-300 ${isReady ? 'opacity-100' : 'opacity-0'}`}
        >
          {artworksLoading && !data ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={`skeleton-${i}`} className="space-y-2">
                  <Skeleton className="aspect-[3/4] w-full rounded-xl bg-gray-200" />
                  <div className="space-y-1">
                    <Skeleton className="h-4 w-3/4 bg-gray-200" />
                    <Skeleton className="h-3 w-1/2 bg-gray-200" />
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
              <div
                ref={virtualListRef}
                className="relative w-full"
                style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
              >
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const startIndex = virtualRow.index * columns
                  const rowItems = allItems.slice(startIndex, startIndex + columns)

                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      className="absolute top-0 left-0 w-full grid gap-3"
                      style={{
                        height: `${virtualRow.size}px`,
                        transform: `translateY(${virtualRow.start - rowVirtualizer.options.scrollMargin}px)`,
                        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`
                      }}
                    >
                      {rowItems.map((artwork, index) => (
                        <ArtworkCard
                          key={`${artwork.id}-${startIndex + index}`}
                          artwork={artwork as any}
                          priority={index < 10}
                        />
                      ))}
                    </div>
                  )
                })}
              </div>

              <div ref={loadMoreRef} className="flex justify-center py-8">
                {isFetchingNextPage && <Loader2 className="h-6 w-6 animate-spin text-gray-400" />}
                {!hasNextPage && allItems.length > 0 && (
                  <div className="text-center text-xs text-neutral-400 uppercase tracking-widest">
                    — End of Collection —
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
