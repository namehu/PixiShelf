'use client'

import React, { useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { SlidersHorizontal } from 'lucide-react'
import { SortOption, MediaTypeFilter } from '@/types'
import { SearchBox } from './_components/search-box'
import { FilterSheet } from './_components/filter-sheet'
import PNav from '@/components/layout/PNav'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import InfiniteArtworkList from './_components/InfiniteArtworkList'

function GalleryPageContent() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // 控制筛选抽屉的开关
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  // 用于显示总数的本地状态
  const [total, setTotal] = useState(0)

  // --- 2. 解析 URL 参数 ---
  const searchQuery = searchParams.get('search') || ''
  const sortBy = (searchParams.get('sortBy') as SortOption) || 'source_date_desc'
  const mediaType = (searchParams.get('mediaType') as MediaTypeFilter) || 'all'

  const updateParams = (key: string, value: string | null) => {
    const newParams = new URLSearchParams(searchParams.toString())
    if (value === null) {
      newParams.delete(key)
    } else {
      newParams.set(key, value)
    }
    router.push(`/artworks?${newParams.toString()}`)
  }

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
        <SearchBox
          value={searchQuery}
          onSearch={(query: string) => updateParams('search', query.trim() || null)}
          className="w-full shadow-sm"
        />
      </PNav>

      {/* 2. 顶部工具栏 (Sticky) */}
      <div className="px-4 sticky top-[64px] z-30 py-2 flex items-center justify-between transition-all backdrop-blur-xl bg-white/80">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
            画廊
            {total > 0 && (
              <Badge variant="secondary" className="rounded-full font-normal">
                {total.toLocaleString()}
              </Badge>
            )}
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

      <main className="container mx-auto pb-10 px-4">
        {/* 3. 虚拟滚动列表 */}
        <InfiniteArtworkList
          searchQuery={searchQuery}
          sortBy={sortBy}
          mediaType={mediaType}
          onTotalChange={setTotal}
          onClearFilters={clearAllFilters}
        />
      </main>
    </div>
  )
}

export default function GalleryPage() {
  return <GalleryPageContent />
}
