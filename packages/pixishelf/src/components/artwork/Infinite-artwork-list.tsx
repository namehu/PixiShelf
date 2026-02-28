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

/**
 * 无限滚动作品列表组件 (InfiniteArtworkList)
 *
 * @description
 * 一个功能丰富的作品列表展示组件，集成了以下核心特性：
 * 1. **虚拟滚动 (Virtual Scrolling)**: 使用 @tanstack/react-virtual 处理长列表渲染，大幅提升性能，支持万级数据流畅滚动。
 * 2. **无限加载 (Infinite Loading)**: 结合 @tanstack/react-query 实现滚动到底部自动加载下一页数据。
 * 3. **多维筛选**: 支持按搜索词、排序、媒体类型、标签、艺术家、日期范围等条件筛选作品。
 * 4. **响应式布局**: 自动监听容器宽度变化，动态计算列数和卡片尺寸，适配各种屏幕尺寸。
 * 5. **滚动位置恢复**: 自动记录并恢复用户的滚动位置，提升浏览体验。
 * 6. **交互反馈**: 内置加载中 (Skeleton)、空状态、错误重试等交互状态。
 */
interface InfiniteArtworkListProps {
  /** 搜索关键词 */
  searchQuery?: string
  /** 排序方式 (如：最新发布、最旧发布、最多浏览等) */
  sortBy?: SortOption
  /** 媒体类型筛选 (全部、图片、视频) */
  mediaType?: MediaTypeFilter
  /** 标签 ID 筛选 */
  tagId?: number
  /** 艺术家 ID 筛选 */
  artistId?: number | string
  /** 开始日期 (格式: YYYY-MM-DD) */
  startDate?: string
  /** 结束日期 (格式: YYYY-MM-DD) */
  endDate?: string
  /** 总数变化回调，用于通知父组件更新统计信息 */
  onTotalChange?: (total: number) => void
  /** 清除筛选回调，当用户点击空状态下的"清除筛选"按钮时触发 */
  onClearFilters?: () => void
  /** 自定义空状态文案 (默认: "没有找到相关作品") */
  emptyMessage?: string
  /** 随机种子，用于随机排序时的稳定性 */
  randomSeed?: number
}

export default function InfiniteArtworkList(props: InfiniteArtworkListProps) {
  const {
    searchQuery = '',
    sortBy = 'source_date_desc',
    mediaType = 'all',
    tagId,
    artistId,
    startDate,
    endDate,
    onTotalChange,
    onClearFilters,
    emptyMessage,
    randomSeed
  } = props

  const trpc = useTRPC()
  const containerRef = useRef<HTMLDivElement>(null)
  const virtualListRef = useRef<HTMLDivElement>(null)
  const columns = useColumns()

  const [containerWidth, setContainerWidth] = useState(0)
  const [isReady, setIsReady] = useState(false)
  const [offsetTop, setOffsetTop] = useState(0)

  const isRequesting = useRef(false)
  const prevInView = useRef(false)

  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } = useInfiniteQuery(
    trpc.artwork.list.infiniteQueryOptions(
      {
        search: searchQuery || undefined,
        sortBy,
        randomSeed: sortBy === 'random' ? randomSeed : undefined,
        mediaType,
        tagId,
        artistId: artistId ? Number(artistId) : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined
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
  const storageKey = `artworks-scroll-${searchQuery}-${sortBy}-${mediaType}-${tagId}-${artistId}-${startDate}-${endDate}-${sortBy === 'random' ? randomSeed : ''}`

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
      window.scrollTo(0, +savedPosition)

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

  useEffect(() => {
    if (containerWidth <= 0) return
    const enteredView = inView && !prevInView.current
    if (enteredView && hasNextPage && !isFetchingNextPage && !isLoading) {
      if (!isRequesting.current) {
        isRequesting.current = true
        fetchNextPage().finally(() => {
          isRequesting.current = false
        })
      }
    }
    prevInView.current = inView
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
        <p className="text-lg font-medium">{emptyMessage || '没有找到相关作品'}</p>
        {onClearFilters && (
          <Button variant="link" onClick={onClearFilters}>
            清除筛选条件试试？
          </Button>
        )}
      </div>
    )
  }

  return (
    <div
      ref={containerRef}
      className={`space-y-8 min-h-[50vh] transition-opacity duration-300 ${isReady ? 'opacity-100' : 'opacity-0'}`}
    >
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
              <div className="text-center text-xs text-neutral-400 uppercase tracking-widest">— 已经到底了 —</div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
