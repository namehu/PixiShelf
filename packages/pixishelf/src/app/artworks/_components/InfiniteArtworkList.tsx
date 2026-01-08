'use client'

import { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from 'react'
import { useInView } from 'react-intersection-observer'
import { Loader2, Filter } from 'lucide-react'
import ArtworkCard from '@/components/artwork/ArtworkCard'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useColumns } from '@/hooks/use-columns'
import { SortOption, MediaTypeFilter } from '@/types'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface InfiniteArtworkListProps {
  searchQuery: string
  sortBy: SortOption
  mediaType: MediaTypeFilter
  onTotalChange?: (total: number) => void
  onClearFilters?: () => void
}

export default function InfiniteArtworkList({
  searchQuery,
  sortBy,
  mediaType,
  onTotalChange,
  onClearFilters
}: InfiniteArtworkListProps) {
  const trpc = useTRPC()
  const containerRef = useRef<HTMLDivElement>(null)
  const virtualListRef = useRef<HTMLDivElement>(null)
  const columns = useColumns()

  const [containerWidth, setContainerWidth] = useState(0)
  const [offsetTop, setOffsetTop] = useState(0)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status, isLoading, isError } = useInfiniteQuery(
    trpc.artwork.list.infiniteQueryOptions(
      {
        search: searchQuery || undefined,
        sortBy,
        mediaType
      },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialCursor: 1
      }
    )
  )

  // 更新 Total
  useEffect(() => {
    if (data?.pages[0]?.total !== undefined && onTotalChange) {
      onTotalChange(data.pages[0].total)
    }
  }, [data?.pages, onTotalChange])

  const allItems = useMemo(() => data?.pages.flatMap((page) => page.items) || [], [data])
  const rowCount = Math.ceil(allItems.length / columns)

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
    // gap-3 = 12px
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

  const { ref: loadMoreRef, inView } = useInView({
    rootMargin: '200px'
  })

  // 生成唯一的存储 key，基于当前的筛选条件
  const storageKey = `artworks-scroll-${searchQuery}-${sortBy}-${mediaType}`

  // 1. 处理滚动恢复
  useLayoutEffect(() => {
    // 禁用浏览器的默认滚动恢复，改由我们手动控制
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    const savedPosition = sessionStorage.getItem(storageKey)
    if (savedPosition && containerWidth > 0 && allItems.length > 0) {
      window.scrollTo(0, parseInt(savedPosition))
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

  useEffect(() => {
    // 增加 containerWidth > 0 的判断，防止初始渲染时触发
    if (inView && hasNextPage && !isFetchingNextPage && !isLoading && containerWidth > 0) {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage, isLoading, containerWidth])

  // 错误状态
  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-red-500">
        <p className="mb-2">加载失败</p>
        <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
          重新加载
        </Button>
      </div>
    )
  }

  // 空状态
  if (!isLoading && allItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-32 text-neutral-400">
        <Filter className="w-12 h-12 mb-4 opacity-20" />
        <p className="text-lg font-medium">没有找到相关作品</p>
        {onClearFilters && (
          <Button variant="link" onClick={onClearFilters}>
            清除筛选条件试试？
          </Button>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} className="space-y-8 min-h-[50vh]">
      {isLoading && !data ? (
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
  )
}
