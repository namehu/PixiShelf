'use client'

import { useEffect, useRef, useState, useMemo, useCallback, useLayoutEffect } from 'react'
import { useInView } from 'react-intersection-observer'
import { Loader2 } from 'lucide-react'
import ArtworkCard from '@/components/artwork/ArtworkCard'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'
import { EnhancedArtworksResponse } from '@/types'
import { useWindowVirtualizer } from '@tanstack/react-virtual'
import { useColumns } from '@/hooks/use-columns'

interface InfiniteArtworkGridProps {
  initialData: EnhancedArtworksResponse & { nextCursor?: number }
}

export default function InfiniteArtworkGrid({ initialData }: InfiniteArtworkGridProps) {
  const trpc = useTRPC()
  const containerRef = useRef<HTMLDivElement>(null)
  const virtualListRef = useRef<HTMLDivElement>(null)
  const columns = useColumns()

  const [containerWidth, setContainerWidth] = useState(0)
  const [isReady, setIsReady] = useState(false)

  const [offsetTop, setOffsetTop] = useState(0)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, status } = useInfiniteQuery(
    trpc.artwork.queryRecommendPage.infiniteQueryOptions(
      { pageSize: 24 },
      {
        getNextPageParam: (lastPage) => lastPage.nextCursor,
        initialCursor: 1,
        initialData: {
          pages: [initialData],
          pageParams: [1]
        },
        staleTime: 20 * 60 * 1000,
        gcTime: 25 * 60 * 1000
      }
    )
  )

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
    // 这里的 48 是 padding (假设 px-6 = 24px * 2)
    const effectiveWidth = containerWidth

    // 避免除以 0
    const safeColumns = columns > 0 ? columns : 1
    const gapTotal = (safeColumns - 1) * 16

    const cardWidth = (effectiveWidth - gapTotal) / safeColumns
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

  // 1. 处理滚动恢复
  useLayoutEffect(() => {
    // 禁用浏览器的默认滚动恢复
    if ('scrollRestoration' in window.history) {
      window.history.scrollRestoration = 'manual'
    }

    const savedPosition = sessionStorage.getItem('dashboard-scroll-position')

    // 如果没有保存的位置，直接标记为准备就绪
    if (!savedPosition) {
      setIsReady(true)
      return
    }

    // 如果有保存位置，等待容器宽度和数据准备好
    if (containerWidth > 0 && allItems.length > 0) {
      // 尝试恢复位置
      const targetScroll = parseInt(savedPosition)
      window.scrollTo(0, targetScroll)

      // 给一点缓冲时间让浏览器完成滚动和绘制，避免闪烁
      // 虽然 requestAnimationFrame 理论上在下一帧，但为了保险起见，
      // 这里的视觉效果是：空白 -> 瞬间出现正确位置
      requestAnimationFrame(() => {
        setIsReady(true)
      })
    }
  }, [containerWidth, allItems.length])

  // 2. 保存滚动位置
  useEffect(() => {
    const handleScroll = () => {
      requestAnimationFrame(() => {
        sessionStorage.setItem('dashboard-scroll-position', window.scrollY.toString())
      })
    }

    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  useEffect(() => {
    if (inView && hasNextPage && !isFetchingNextPage && containerWidth > 0) {
      fetchNextPage()
    }
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage, containerWidth])

  if (status === 'error') {
    return <div className="p-8 text-center text-red-500">加载失败</div>
  }

  if (allItems.length === 0) {
    return <div className="p-12 text-center">暂无推荐作品</div>
  }

  return (
    <div
      ref={containerRef}
      className={`space-y-8 transition-opacity duration-300 ${isReady ? 'opacity-100' : 'opacity-0'}`}
    >
      <div ref={virtualListRef} className="relative w-full" style={{ height: `${rowVirtualizer.getTotalSize()}px` }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIndex = virtualRow.index * columns
          const rowItems = allItems.slice(startIndex, startIndex + columns)

          return (
            <div
              key={virtualRow.key}
              data-index={virtualRow.index}
              className="absolute top-0 left-0 w-full grid gap-4"
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
      </div>
    </div>
  )
}
