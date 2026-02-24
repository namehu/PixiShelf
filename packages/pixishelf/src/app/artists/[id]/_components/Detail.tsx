'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'
import { useQueryStates, parseAsString } from 'nuqs'
import { useRouter } from 'next/navigation'
import { SortOption, MediaTypeFilter } from '@/types'
import { SlidersHorizontal, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterSheet } from '@/components/artwork/filter-sheet'
import HeadInfo from './HeadInfo'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import { format, parseISO } from 'date-fns'
import { DatePickerRange } from '@/components/shared/date-range-picker'
import PNav from '@/components/layout/PNav'
import { SearchBox } from '@/app/artworks/_components/search-box'
import { cn } from '@/lib/utils'
import InfiniteArtworkList from '@/components/artwork/Infinite-artwork-list'

export default function ArtistDetailPage({ artist, id }: { artist: ArtistResponseDto; id: string }) {
  const router = useRouter()
  const [isScrolled, setIsScrolled] = useState(false)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [total, setTotal] = useState(0)

  // 监听滚动以切换导航栏样式
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 50)
    }
    window.addEventListener('scroll', handleScroll)
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  const [{ sortBy, startDate, endDate, search, mediaType }, setQuery] = useQueryStates(
    {
      sortBy: parseAsString.withDefault('source_date_desc').withOptions({ history: 'replace' }),
      startDate: parseAsString.withDefault('').withOptions({ history: 'replace' }),
      endDate: parseAsString.withDefault('').withOptions({ history: 'replace' }),
      search: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
      mediaType: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: true })
    },
    { history: 'replace' }
  )

  // 构造 DatePickerRange 需要的 value 格式
  const dateRange = useMemo<[Date | undefined, Date | undefined]>(() => {
    const start = startDate ? parseISO(startDate) : undefined
    const end = endDate ? parseISO(endDate) : undefined
    return [start, end]
  }, [startDate, endDate])

  // 处理变更
  const handleDateChange = useCallback(
    (vals: [Date | undefined, Date | undefined]) => {
      const [start, end] = vals
      setQuery({
        startDate: start ? format(start, 'yyyy-MM-dd') : null,
        endDate: end ? format(end, 'yyyy-MM-dd') : null
      })
    },
    [setQuery]
  )

  // 处理筛选变更
  const handleApplyFilters = (filters?: { mediaType: MediaTypeFilter; sortBy: SortOption }) => {
    if (!filters) return

    setQuery({
      mediaType: filters.mediaType,
      sortBy: filters.sortBy
    })
  }

  // 清除所有筛选
  const clearAllFilters = useCallback(() => {
    setQuery({
      search: null,
      startDate: null,
      endDate: null,
      sortBy: 'source_date_desc',
      mediaType: 'all'
    })
  }, [setQuery])

  return (
    <div className="relative">
      {/* 顶部悬浮导航栏 */}
      <PNav
        border={false}
        showLogo={false}
        showUserMenu={false}
        placeholder={false}
        className={cn(
          'fixed top-0 left-0 right-0 z-50 transition-all duration-300',
          isScrolled ? 'bg-white/80 backdrop-blur-md shadow-sm' : 'bg-transparent'
        )}
        renderLeft={
          <div
            className={cn(
              'flex items-center cursor-pointer transition-colors hover:opacity-80',
              isScrolled ? 'text-gray-700' : 'text-white/90 drop-shadow-md'
            )}
            onClick={() => router.back()}
          >
            <ChevronLeft className="w-5 h-5 mr-0.5" />
          </div>
        }
        renderExtra={
          <Button
            variant="outline"
            size="icon"
            className={cn('ml-2', !isScrolled && 'bg-white/90 backdrop-blur-sm border-transparent')}
            onClick={() => setIsFilterOpen(true)}
          >
            <SlidersHorizontal className="w-4 h-4" />
          </Button>
        }
      >
        <div className="w-full max-w-xl transition-opacity duration-300">
          <SearchBox
            value={search || ''}
            placeholder="搜索艺术家的作品"
            onSearch={(val) => setQuery({ search: val })}
            className={cn('w-full shadow-sm', !isScrolled && 'bg-white/90 backdrop-blur-sm border-transparent')}
          />
        </div>
      </PNav>

      <FilterSheet
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        currentMediaType={mediaType as MediaTypeFilter}
        currentSortBy={sortBy as SortOption}
        onApply={handleApplyFilters}
      />

      <HeadInfo artist={artist} />
      {/* 作品列表部分 */}
      <div className="space-y-6 px-4 my-4">
        {/* 作品列表标题和排序 */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">作品集</h2>
            <p className="text-gray-600 mt-1">{`共 ${total} 件作品`}</p>
          </div>

          <div className="flex flex-row items-center gap-2 w-full sm:w-auto justify-end">
            <DatePickerRange value={dateRange} onChange={handleDateChange} className="flex-1 sm:flex-none w-auto" />
          </div>
        </div>

        <InfiniteArtworkList
          artistId={id}
          searchQuery={search || ''}
          sortBy={sortBy as SortOption}
          mediaType={mediaType as MediaTypeFilter}
          startDate={startDate || undefined}
          endDate={endDate || undefined}
          onTotalChange={setTotal}
          onClearFilters={clearAllFilters}
          emptyMessage="该艺术家还没有上传任何作品"
        />
      </div>
    </div>
  )
}
