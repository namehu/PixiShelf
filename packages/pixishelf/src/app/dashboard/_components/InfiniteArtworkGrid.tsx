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
        staleTime: 5 * 60 * 1000,
        gcTime: 10 * 60 * 1000
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

  useEffect(() => {
    let timer: NodeJS.Timeout
    if (inView && hasNextPage && !isFetchingNextPage) {
      timer = setTimeout(() => {
        fetchNextPage()
      }, 100)
    }
    return () => clearTimeout(timer)
  }, [inView, hasNextPage, isFetchingNextPage, fetchNextPage])

  if (status === 'error') {
    return <div className="p-8 text-center text-red-500">加载失败</div>
  }

  if (allItems.length === 0) {
    return <div className="p-12 text-center">暂无推荐作品</div>
  }

  return (
    <div ref={containerRef} className="space-y-8">
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
