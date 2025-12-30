'use client'

import React, { useState, useEffect, useMemo } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useInView } from 'react-intersection-observer'
import { Loader2, Filter, SlidersHorizontal, X } from 'lucide-react'

// --- 原始 Imports (保持路径一致) ---
import { EnhancedArtworksResponse, SortOption, MediaTypeFilter } from '@/types'
import { useAuth } from '@/components/auth'
import { SortControl } from '@/components/ui/SortControl'
import { SearchBox } from './_components/SearchBox'
import { MediaTypeFilter as MediaTypeFilterComponent } from '@/components/ui/MediaTypeFilter'
// 分页组件已移除，使用无限滚动替代
import { client, apiJson } from '@/lib/api' // 注意：这里修正了 import 顺序
import { ROUTES } from '@/lib/constants'
import ArtworkCard from '@/components/artwork/ArtworkCard'
import PNav from '@/components/layout/PNav'

// --- 新增 UI 组件 (假设基于 Shadcn UI) ---
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger
} from '@/components/ui/sheet'

// ============================================================================
// Hooks (保持原有逻辑，稍作优化)
// ============================================================================

/**
 * 获取作品列表Hook
 * (逻辑保持不变，仅用于单页数据获取)
 */
function useArtworks(
  page: number,
  pageSize: number,
  tags?: string[],
  search?: string,
  sortBy?: SortOption,
  mediaType?: MediaTypeFilter
) {
  const [data, setData] = useState<EnhancedArtworksResponse | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isError, setIsError] = useState(false)

  // 这里的依赖项非常重要，它们变化时会触发 fetch
  useEffect(() => {
    const fetchArtworks = async () => {
      try {
        setIsLoading(true)
        setIsError(false)

        const url = new URL('/api/artworks', window.location.origin)
        url.searchParams.set('page', String(page))
        url.searchParams.set('pageSize', String(pageSize))
        if (tags && tags.length > 0) {
          url.searchParams.set('tags', tags.join(','))
        }
        if (search && search.trim()) {
          url.searchParams.set('search', search.trim())
        }
        if (sortBy && sortBy !== 'source_date_desc') {
          url.searchParams.set('sortBy', sortBy)
        }
        if (mediaType && mediaType !== 'all') {
          url.searchParams.set('mediaType', mediaType)
        }

        const result = await client<EnhancedArtworksResponse>(url.toString())
        setData(result)
      } catch (error) {
        console.error('Failed to fetch artworks:', error)
        setIsError(true)
      } finally {
        setIsLoading(false)
      }
    }

    fetchArtworks()
  }, [page, pageSize, tags, search, sortBy, mediaType])

  return { data, isLoading, isError }
}

/**
 * 获取扫描状态Hook (保持不变)
 */
function useScanStatus() {
  const [data, setData] = useState<{ scanning: boolean; message: string | null } | null>(null)

  useEffect(() => {
    const fetchScanStatus = async () => {
      try {
        const result = await apiJson<{ scanning: boolean; message: string | null }>('/api/scan/status')
        setData(result)
      } catch (error) {
        console.error('Failed to fetch scan status:', error)
      }
    }

    fetchScanStatus()

    const interval = setInterval(() => {
      if (data?.scanning) {
        fetchScanStatus()
      }
    }, 1000)

    return () => clearInterval(interval)
  }, [data?.scanning])

  return { data }
}

// ============================================================================
// 画廊页面内容组件 (重构核心)
// ============================================================================

function GalleryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { isAuthenticated, isLoading: authLoading } = useAuth()
  const scanStatus = useScanStatus()

  // --- 1. 状态管理 ---
  // 本地页码状态，初始为 1
  const [page, setPage] = useState(1)
  // 累积的作品列表
  const [accumulatedArtworks, setAccumulatedArtworks] = useState<any[]>([])
  // 是否还有更多数据
  const [hasMore, setHasMore] = useState(true)
  // 控制筛选抽屉的开关
  const [isFilterOpen, setIsFilterOpen] = useState(false)

  const pageSize = 24

  // --- 2. 解析 URL 参数 ---
  const selectedTags = useMemo(() => searchParams.get('tags')?.split(',').filter(Boolean) || [], [searchParams])
  const searchQuery = searchParams.get('search') || ''
  const sortBy = (searchParams.get('sortBy') as SortOption) || 'source_date_desc'
  const mediaType = (searchParams.get('mediaType') as MediaTypeFilter) || 'all'

  // 生成筛选条件的指纹，用于判断是否需要重置列表
  const filterFingerprint = JSON.stringify({
    tags: selectedTags,
    search: searchQuery,
    sort: sortBy,
    media: mediaType
  })

  // --- 3. 调用 API Hook ---
  const { data, isLoading, isError } = useArtworks(
    page,
    pageSize,
    selectedTags.length > 0 ? selectedTags : undefined,
    searchQuery || undefined,
    sortBy,
    mediaType
  )

  // --- 4. 滚动监听 ---
  const { ref: loadMoreRef, inView } = useInView({
    threshold: 0,
    rootMargin: '200px' // 提前 200px 触发加载，体验更流畅
  })

  // --- 5. 核心逻辑：筛选变更重置 ---
  useEffect(() => {
    // 当筛选条件改变时，重置为第一页，清空列表，并滚动到顶部
    setPage(1)
    setAccumulatedArtworks([])
    setHasMore(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }, [filterFingerprint])

  // --- 6. 核心逻辑：数据累加 ---
  useEffect(() => {
    if (data?.items) {
      if (page === 1) {
        //如果是第一页，直接覆盖
        setAccumulatedArtworks(data.items)
      } else {
        // 如果是后续页，追加数据 (简单的去重防止 React StrictMode 下的双重追加)
        setAccumulatedArtworks((prev) => {
          const newIds = new Set(data.items.map((i) => i.id))
          const filteredPrev = prev.filter((p) => !newIds.has(p.id))
          return [...filteredPrev, ...data.items]
        })
      }

      // 判断是否还有下一页
      const isEnd =
        data.items.length < pageSize || (data.total > 0 && accumulatedArtworks.length + data.items.length >= data.total)
      if (isEnd) {
        setHasMore(false)
      }
    }
  }, [data, page]) // 依赖 data 和 page

  // --- 7. 核心逻辑：触发下一页 ---
  useEffect(() => {
    // 只有当：进入视口 + 非加载中 + 还有更多 + 当前列表不为空 时才加载下一页
    if (inView && !isLoading && hasMore && accumulatedArtworks.length > 0) {
      setPage((prev) => prev + 1)
    }
  }, [inView, isLoading, hasMore, accumulatedArtworks.length])

  // --- 8. 交互处理函数 ---
  const updateParams = (key: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams.toString())
    if (value === null) {
      newParams.delete(key)
    } else {
      newParams.set(key, value)
    }
    // 任何筛选改变都重置回第一页
    // 注意：这里的重置主要体现在 URL 变动 -> 触发 useEffect [filterFingerprint] -> 触发 setPage(1)
    // 所以这里不需要手动 setPage(1)
    router.push(`/gallery?${newParams.toString()}`)
  }

  const handleSearch = (query: string) => updateParams('search', query.trim() || null)
  const handleSortChange = (val: SortOption) => updateParams('sortBy', val === 'source_date_desc' ? null : val)
  const handleMediaTypeChange = (val: MediaTypeFilter) => updateParams('mediaType', val === 'all' ? null : val)
  const removeTag = (tag: string) => {
    const newTags = selectedTags.filter((t) => t !== tag)
    updateParams('tags', newTags.length > 0 ? newTags.join(',') : null)
  }
  const clearAllFilters = () => {
    router.push('/gallery')
  }

  // --- 9. 认证与加载状态检查 ---
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      router.push(`${ROUTES.LOGIN}?redirect=/gallery`)
    }
  }, [isAuthenticated, authLoading, router])

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!isAuthenticated) return null

  // --- 渲染 ---
  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* 1. 顶部导航栏集成搜索框 */}
      <PNav border={false}>
        <SearchBox value={searchQuery} onSearch={handleSearch} className="w-full shadow-sm" />
      </PNav>

      {/* 2. 顶部工具栏 (Sticky) */}
      <div className="px-4 sticky top-[63px] z-30  py-4 flex items-center justify-between transition-all backdrop-blur-xl bg-white/80">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            画廊
            {data?.total ? (
              <Badge variant="secondary" className="rounded-full font-normal">
                {data.total.toLocaleString()}
              </Badge>
            ) : null}
          </h1>
          {/* 扫描状态提示 */}
          {scanStatus.data?.scanning && (
            <span className="text-xs text-primary animate-pulse flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-primary" />
              正在扫描: {scanStatus.data.message}
            </span>
          )}
        </div>

        {/* 筛选按钮 (触发 Sheet) */}
        <Sheet open={isFilterOpen} onOpenChange={setIsFilterOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="sm" className="gap-2 rounded-full border-gray-300 shadow-sm hover:bg-white">
              <SlidersHorizontal className="w-4 h-4" />
              <span className="hidden sm:inline">筛选与排序</span>
              <span className="sm:hidden">筛选</span>
              {/* 如果有活跃筛选，显示小红点 */}
              {(selectedTags.length > 0 || mediaType !== 'all') && (
                <span className="w-2 h-2 rounded-full bg-red-500 absolute top-0 right-0 -mt-1 -mr-1" />
              )}
            </Button>
          </SheetTrigger>

          {/* 筛选抽屉内容 */}
          <SheetContent
            side="bottom"
            className="rounded-t-[20px] sm:max-w-md sm:rounded-none sm:side-right h-[85vh] sm:h-full overflow-y-auto"
          >
            <SheetHeader>
              <SheetTitle>筛选与显示</SheetTitle>
              <SheetDescription>调整选项以精确查找内容</SheetDescription>
            </SheetHeader>

            <div className="py-6 space-y-8">
              {/* 活跃的标签 (Tag Chips) */}
              {selectedTags.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">已选标签</h3>
                  <div className="flex flex-wrap gap-2">
                    {selectedTags.map((tag) => (
                      <Badge
                        key={tag}
                        variant="secondary"
                        className="px-3 py-1 gap-1 hover:bg-red-50 hover:text-red-600 cursor-pointer transition-colors"
                        onClick={() => removeTag(tag)}
                      >
                        #{tag}
                        <X className="w-3 h-3" />
                      </Badge>
                    ))}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-neutral-400"
                      onClick={() => updateParams('tags', null)}
                    >
                      清除标签
                    </Button>
                  </div>
                </div>
              )}

              {/* 排序控制 */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">排序方式</h3>
                <SortControl value={sortBy} onChange={handleSortChange} className="w-full" />
              </div>

              {/* 媒体类型 */}
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">媒体类型</h3>
                <MediaTypeFilterComponent
                  value={mediaType}
                  onChange={handleMediaTypeChange}
                  className="w-full justify-start"
                />
              </div>
            </div>

            <SheetFooter className="gap-2 sm:gap-0">
              {(selectedTags.length > 0 || mediaType !== 'all' || sortBy !== 'source_date_desc' || searchQuery) && (
                <Button variant="outline" className="w-full sm:w-auto" onClick={clearAllFilters}>
                  重置所有
                </Button>
              )}
              <Button className="w-full sm:w-auto" onClick={() => setIsFilterOpen(false)}>
                查看结果
              </Button>
            </SheetFooter>
          </SheetContent>
        </Sheet>
      </div>

      <main className="container mx-auto pb-10">
        {/* 3. 作品网格 (Pixiv 风格) */}
        <div className="px-4 grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7">
          {accumulatedArtworks.map((artwork) => (
            <ArtworkCard key={`${artwork.id}-${artwork.updatedAt}`} artwork={artwork} />
          ))}

          {/* Loading Skeletons */}
          {isLoading &&
            hasMore &&
            Array.from({ length: pageSize / 2 }).map((_, i) => (
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

// ============================================================================
// 页面入口
// ============================================================================

export default function GalleryPage() {
  return <GalleryPageContent />
}
