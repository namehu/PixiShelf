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
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'

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
        containerSize="gallery"
        leading={
          <Button variant="ghost" size="icon" onClick={safeBack} aria-label="返回艺术家列表">
            <ChevronLeft data-icon="inline-start" aria-hidden="true" />
          </Button>
        }
        actions={
          <Button variant="outline" size="icon" onClick={() => setIsFilterOpen(true)} aria-label="筛选作品">
            <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
          </Button>
        }
      >
        <div className="w-full max-w-xl transition-opacity duration-300">
          <SearchBox
            value={search || ''}
            placeholder="搜索艺术家的作品"
            onSearch={(val) => setQuery({ search: val })}
            className="w-full"
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
      <PageContainer size="gallery" className="flex flex-col gap-6 py-8">
        <SectionHeader title="作品" description={`共 ${total} 件作品`} />

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
      </PageContainer>
    </div>
  )
}
