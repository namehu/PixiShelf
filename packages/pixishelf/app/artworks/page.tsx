'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ImageUpIcon, SlidersHorizontal } from 'lucide-react'
import { SortOption, MediaTypeFilter } from '@/types'
import { SearchBox } from './_components/search-box'
import { FilterSheet } from '@/components/artwork/filter-sheet'
import PNav from '@/components/layout/PNav'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import InfiniteArtworkList from '@/components/artwork/Infinite-artwork-list'
import { createSerializer, useQueryStates, parseAsInteger, parseAsString } from 'nuqs'
import dayjs from 'dayjs'

const searchParamsParsers = {
  search: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  sortBy: parseAsString.withDefault('source_date_desc').withOptions({ history: 'replace', clearOnDefault: true }),
  randomSeed: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  mediaType: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: true }),
  startDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  endDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true })
}

const viewerQueryParsers = {
  source: parseAsString,
  mode: parseAsString,
  sortBy: parseAsString,
  randomSeed: parseAsInteger,
  search: parseAsString,
  mediaType: parseAsString,
  startDate: parseAsString,
  endDate: parseAsString
}

const serializeViewerQuery = createSerializer(viewerQueryParsers)

export default function GalleryPage() {
  const [queryStates, setQueryStates] = useQueryStates(searchParamsParsers)
  const { search: searchQuery, sortBy, randomSeed, mediaType, startDate, endDate } = queryStates

  // 控制筛选抽屉的开关
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  // 用于显示总数的本地状态
  const [total, setTotal] = useState(0)

  const immersiveViewerHref = useMemo(() => {
    const randomSeedValue = randomSeed ? Number(randomSeed) : null

    return serializeViewerQuery('/viewer', {
      source: 'all',
      mode: sortBy === 'random' ? 'random' : 'ordered',
      sortBy: sortBy === 'random' ? null : sortBy || 'source_date_desc',
      randomSeed: sortBy === 'random' && Number.isFinite(randomSeedValue) ? randomSeedValue : null,
      search: searchQuery || null,
      mediaType: mediaType && mediaType !== 'all' ? mediaType : null,
      startDate: startDate || null,
      endDate: endDate || null
    })
  }, [endDate, mediaType, randomSeed, searchQuery, sortBy, startDate])

  const handleSearch = (query: string) => {
    setQueryStates({ search: query.trim() || null })
  }

  const handleApplyFilters = (filters?: {
    mediaType: MediaTypeFilter
    sortBy: SortOption
    randomSeed?: number
    startTime?: string
    endTime?: string
  }) => {
    if (!filters) {
      return clearAllFilters()
    }

    setQueryStates({
      mediaType: filters.mediaType,
      sortBy: filters.sortBy,
      randomSeed: filters.randomSeed ? filters.randomSeed.toString() : null,
      startDate: filters.startTime ? dayjs(filters.startTime).format('YYYY-MM-DD') : null,
      endDate: filters.endTime ? dayjs(filters.endTime).format('YYYY-MM-DD') : null
    })
  }

  const clearAllFilters = () => {
    setQueryStates({
      search: null,
      sortBy: null,
      randomSeed: null,
      mediaType: null,
      startDate: null,
      endDate: null
    })
  }

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* 1. 顶部导航栏集成搜索框 */}
      <PNav
        border={false}
        showUserMenu={false}
        renderExtra={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild>
              <Link href={immersiveViewerHref}>
                <ImageUpIcon className="w-4 h-4" />
                <span className="hidden sm:inline">沉浸浏览</span>
              </Link>
            </Button>
            <Button variant="outline" onClick={() => setIsFilterOpen(true)}>
              <SlidersHorizontal className="w-4 h-4" />
            </Button>
          </div>
        }
      >
        <SearchBox value={searchQuery} onSearch={handleSearch} className="w-full shadow-sm" />
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

        {/* 筛选按钮 (触发 Sheet) */}
        <FilterSheet
          open={isFilterOpen}
          onOpenChange={setIsFilterOpen}
          currentMediaType={mediaType as MediaTypeFilter}
          currentSortBy={sortBy as SortOption}
          randomSeed={randomSeed ? Number(randomSeed) : undefined}
          startDate={startDate}
          endDate={endDate}
          onApply={handleApplyFilters}
        />
      </div>

      <main className="container mx-auto pb-10 px-4">
        {/* 3. 虚拟滚动列表 */}
        <InfiniteArtworkList
          searchQuery={searchQuery}
          sortBy={sortBy as SortOption}
          mediaType={mediaType as MediaTypeFilter}
          randomSeed={randomSeed ? Number(randomSeed) : undefined}
          startDate={startDate || undefined}
          endDate={endDate || undefined}
          onTotalChange={setTotal}
          onClearFilters={clearAllFilters}
        />
      </main>
    </div>
  )
}
