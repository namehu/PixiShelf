'use client'

import { useMemo, useState, useCallback } from 'react'
import { createSerializer, useQueryStates, parseAsInteger, parseAsString } from 'nuqs'
import { SortOption, MediaTypeFilter } from '@/types'
import { SlidersHorizontal, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { FilterSheet } from '@/components/artwork/filter-sheet'
import HeadInfo from './head-info'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import PageToolbar from '@/components/layout/page-toolbar'
import { SearchBox } from '@/app/artworks/_components/search-box'
import InfiniteArtworkList from '@/components/artwork/infinite-artwork-list'
import dayjs from 'dayjs'
import { useSafeBack } from '@/hooks/use-safe-back'

const viewerQueryParsers = {
  source: parseAsString,
  sourceId: parseAsInteger,
  mode: parseAsString,
  sortBy: parseAsString,
  randomSeed: parseAsInteger,
  search: parseAsString,
  artistId: parseAsInteger,
  artistLabel: parseAsString,
  mediaType: parseAsString,
  startDate: parseAsString,
  endDate: parseAsString
}

const serializeViewerQuery = createSerializer(viewerQueryParsers)

export default function ArtistDetailPage({ artist, id }: { artist: ArtistResponseDto; id: string }) {
  const safeBack = useSafeBack('/artists')
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [total, setTotal] = useState(0)

  const [{ sortBy, startDate, endDate, search, mediaType, randomSeed }, setQuery] = useQueryStates(
    {
      sortBy: parseAsString.withDefault('source_date_desc').withOptions({ history: 'replace' }),
      startDate: parseAsString.withDefault('').withOptions({ history: 'replace' }),
      endDate: parseAsString.withDefault('').withOptions({ history: 'replace' }),
      search: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
      mediaType: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: true }),
      randomSeed: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true })
    },
    { history: 'replace' }
  )

  // 处理筛选变更
  const handleApplyFilters = (filters?: {
    mediaType: MediaTypeFilter
    sortBy: SortOption
    randomSeed?: number
    startTime?: string
    endTime?: string
  }) => {
    if (!filters) return

    setQuery({
      mediaType: filters.mediaType,
      sortBy: filters.sortBy,
      randomSeed: filters.randomSeed ? String(filters.randomSeed) : null,
      startDate: filters.startTime ? dayjs(filters.startTime).format('YYYY-MM-DD') : null,
      endDate: filters.endTime ? dayjs(filters.endTime).format('YYYY-MM-DD') : null
    })
  }

  // 清除所有筛选
  const clearAllFilters = useCallback(() => {
    setQuery({
      search: null,
      startDate: null,
      endDate: null,
      sortBy: 'source_date_desc',
      mediaType: 'all',
      randomSeed: null
    })
  }, [setQuery])

  const immersiveViewerHref = useMemo(() => {
    const randomSeedValue = randomSeed ? Number(randomSeed) : null

    return serializeViewerQuery('/viewer', {
      source: 'artist',
      sourceId: Number(id),
      mode: sortBy === 'random' ? 'random' : 'ordered',
      sortBy: sortBy === 'random' ? null : sortBy || 'source_date_desc',
      randomSeed: sortBy === 'random' && Number.isFinite(randomSeedValue) ? randomSeedValue : null,
      search: search || null,
      artistId: Number(id),
      artistLabel: artist.name,
      mediaType: mediaType || 'all',
      startDate: startDate || null,
      endDate: endDate || null
    })
  }, [artist.name, endDate, id, mediaType, randomSeed, search, sortBy, startDate])

  return (
    <div className="relative">
      <PageToolbar
        leading={
          <Button variant="ghost" size="icon" onClick={safeBack} aria-label="返回艺术家列表">
            <ChevronLeft className="w-5 h-5 mr-0.5" />
          </Button>
        }
        actions={
          <Button variant="outline" size="icon" onClick={() => setIsFilterOpen(true)} aria-label="筛选作品">
            <SlidersHorizontal className="w-4 h-4" />
          </Button>
        }
      >
        <div className="w-full max-w-xl transition-opacity duration-300">
          <SearchBox
            value={search || ''}
            placeholder="搜索艺术家的作品"
            onSearch={(val) => setQuery({ search: val })}
            className="w-full shadow-sm"
          />
        </div>
      </PageToolbar>

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

      <HeadInfo artist={artist} immersiveHref={immersiveViewerHref} />
      {/* 作品列表部分 */}
      <div className="space-y-6 px-4 my-4">
        {/* 作品列表标题和排序 */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold text-gray-900">作品集</h2>
          <span className="text-gray-600">{`共 ${total} 件作品`}</span>
        </div>

        <InfiniteArtworkList
          artistId={id}
          searchQuery={search || ''}
          sortBy={sortBy as SortOption}
          randomSeed={randomSeed ? Number(randomSeed) : undefined}
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
