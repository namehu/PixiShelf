'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useInView } from 'react-intersection-observer'
import { Filter, SlidersHorizontal } from 'lucide-react'
import { SortOption, MediaTypeFilter } from '@/types'
import { SearchBox } from './_components/search-box'
import { FilterSheet } from './_components/filter-sheet'
import ArtworkCard from '@/components/artwork/ArtworkCard'
import PNav from '@/components/layout/PNav'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { useTRPC } from '@/lib/trpc'
import { useInfiniteQuery } from '@tanstack/react-query'

function GalleryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const trpc = useTRPC()

  // 控制筛选抽屉的开关
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  // --- 2. 解析 URL 参数 ---
  const searchQuery = searchParams.get('search') || ''
  const sortBy = (searchParams.get('sortBy') as SortOption) || 'source_date_desc'
  const mediaType = (searchParams.get('mediaType') as MediaTypeFilter) || 'all'

  // --- 3. 调用 API Hook ---
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading, isError } = useInfiniteQuery(
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

  const accumulatedArtworks = useMemo(() => data?.pages.flatMap((page) => page.items) || [], [data])
  const total = data?.pages[0]?.total || 0

  // --- 4. 滚动监听 ---
  const { ref: loadMoreRef, inView } = useInView({
    rootMargin: '200px' // 提前 200px 触发加载，体验更流畅
  })

  // --- 7. 核心逻辑：触发下一页 ---
  useEffect(() => {
    if (inView && !isLoading && hasMore && !isFetchingNextPage) {
      fetchNextPage()
    }
  }, [inView, isLoading, hasNextPage, isFetchingNextPage, fetchNextPage])

  // 为了保持兼容性变量名
  const hasMore = hasNextPage

  // --- 8. 交互处理函数 ---
  const updateParams = (key: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams.toString())
    if (value === null) {
      newParams.delete(key)
    } else {
      newParams.set(key, value)
    }
    router.push(`/artworks?${newParams.toString()}`)
  }

  const handleSearch = (query: string) => updateParams('search', query.trim() || null)

  const handleApplyFilters = (filters?: { mediaType: MediaTypeFilter; sortBy: SortOption }) => {
    const newParams = new URLSearchParams(searchParams.toString())

    if (!filters) {
      return clearAllFilters()
    }

    if (filters.mediaType !== 'all') {
      newParams.set('mediaType', filters.mediaType)
    } else {
      newParams.delete('mediaType')
    }

    if (filters.sortBy !== 'source_date_desc') {
      newParams.set('sortBy', filters.sortBy)
    } else {
      newParams.delete('sortBy')
    }

    router.push(`/artworks?${newParams.toString()}`)
  }

  const clearAllFilters = () => {
    router.push('/artworks')
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* 1. 顶部导航栏集成搜索框 */}
      <PNav border={false}>
        <SearchBox value={searchQuery} onSearch={handleSearch} className="w-full shadow-sm" />
      </PNav>

      {/* 2. 顶部工具栏 (Sticky) */}
      <div className="px-4 sticky top-[64px] z-30  py-2 flex items-center justify-between transition-all backdrop-blur-xl bg-white/80">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            画廊
            {total ? (
              <Badge variant="secondary" className="rounded-full font-normal">
                {total.toLocaleString()}
              </Badge>
            ) : null}
          </h1>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2 rounded-full border-gray-300 shadow-sm hover:bg-white relative"
          onClick={() => setIsFilterOpen(true)}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span className="hidden sm:inline">筛选与排序</span>
          <span className="sm:hidden">筛选</span>
        </Button>

        {/* 筛选按钮 (触发 Sheet) */}
        <FilterSheet
          open={isFilterOpen}
          onOpenChange={setIsFilterOpen}
          currentMediaType={mediaType}
          currentSortBy={sortBy}
          onApply={handleApplyFilters}
        />
      </div>

      <main className="container mx-auto pb-10">
        {/* 3. 作品网格 (Pixiv 风格) */}
        <div className="px-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {accumulatedArtworks.map((artwork) => (
            <ArtworkCard key={`${artwork.id}-${artwork.updatedAt}`} artwork={artwork as any} />
          ))}

          {/* Loading Skeletons */}
          {(isLoading || isFetchingNextPage) &&
            Array.from({ length: 12 }).map((_, i) => (
              <div key={`skeleton-${i}`} className="space-y-2">
                <Skeleton className="aspect-[3/4] w-full rounded-xl bg-gray-200" />
                <div className="space-y-1">
                  <Skeleton className="h-4 w-3/4 bg-gray-200" />
                  <Skeleton className="h-3 w-1/2 bg-gray-200" />
                </div>
              </div>
            ))}
        </div>

        {/* 4. 空状态与错误处理 */}
        {!isLoading && accumulatedArtworks.length === 0 && !isError && (
          <div className="flex flex-col items-center justify-center py-32 text-neutral-400">
            <Filter className="w-12 h-12 mb-4 opacity-20" />
            <p className="text-lg font-medium">没有找到相关作品</p>
            <Button variant="link" onClick={clearAllFilters}>
              清除筛选条件试试？
            </Button>
          </div>
        )}

        {isError && (
          <div className="flex flex-col items-center justify-center py-20 text-red-500">
            <p className="mb-2">加载失败</p>
            <Button variant="outline" size="sm" onClick={() => window.location.reload()}>
              重新加载
            </Button>
          </div>
        )}

        {/* 5. 底部触发器 (Intersection Observer Target) */}
        <div
          ref={loadMoreRef}
          className="h-20 w-full flex items-center justify-center mt-8 opacity-0 pointer-events-none"
        />

        {!hasMore && accumulatedArtworks.length > 0 && (
          <div className="text-center py-8 text-xs text-neutral-400 uppercase tracking-widest border-t border-gray-100 mt-8">
            — End of Collection —
          </div>
        )}
      </main>
    </div>
  )
}

export default function GalleryPage() {
  return <GalleryPageContent />
}
