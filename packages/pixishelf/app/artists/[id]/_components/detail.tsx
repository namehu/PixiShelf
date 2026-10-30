'use client'

import { useMemo, useState } from 'react'
import { createSerializer, useQueryStates, parseAsInteger, parseAsString } from 'nuqs'
import { SlidersHorizontal, ChevronLeft } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GalleryFilterSheet } from '@/components/artwork/gallery-filter-sheet'
import type { FilterSheetProps } from '@/components/artwork/filter-sheet'
import HeadInfo from './head-info'
import type { ArtistResponseDto } from '@/schemas/artist.dto'
import PageToolbar from '@/components/layout/page-toolbar'
import { SearchBox } from '@/app/artworks/_components/search-box'
import InfiniteArtworkList from '@/components/artwork/infinite-artwork-list'
import dayjs from 'dayjs'
import { useSafeBack } from '@/hooks/use-safe-back'
import { PageContainer } from '@/components/layout/page-container'
import { SectionHeader } from '@/components/layout/section-header'
import { useTRPCClient } from '@/lib/trpc'
import { artworkQueryParsers, queryToSnapshot, snapshotToQuery } from '@/lib/artwork-query-snapshot'
import { artworkQuerySnapshotSchema, type ArtworkQuerySnapshot } from '@/schemas/artwork-quick-filter.dto'

const queryParsers = { ...artworkQueryParsers, listRevision: parseAsInteger.withDefault(0) }
const serializeQuery = createSerializer(artworkQueryParsers)
const serializeViewerQuery = createSerializer({
  ...artworkQueryParsers,
  source: parseAsString,
  sourceId: parseAsInteger,
  scopeArtistId: parseAsInteger,
  mode: parseAsString,
  mediaType: parseAsString
})

export default function ArtistDetailPage({ artist, id }: { artist: ArtistResponseDto; id: string }) {
  const safeBack = useSafeBack('/artists')
  const client = useTRPCClient()
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [urlQuery, setQuery] = useQueryStates(queryParsers, { history: 'replace' })
  // The route owns the artist; saved filters and URL search conditions are additional constraints only.
  const query = useMemo(
    () => queryToSnapshot(new URLSearchParams(serializeQuery({ ...urlQuery, artistId: null, artistLabel: null }))),
    [urlQuery]
  )
  const fixedArtist = useMemo(() => ({ value: id, label: artist.name }), [id, artist.name])
  const scope = useMemo(() => ({ kind: 'artist' as const, artistId: Number(id) }), [id])
  const tagIds = useMemo(() => query.tags.map((tag) => Number(tag.value)), [query.tags])
  const excludeArtistIds = useMemo(
    () => query.excludedArtists.map((artist) => Number(artist.value)),
    [query.excludedArtists]
  )
  const randomSeed = urlQuery.randomSeed ? Number(urlQuery.randomSeed) : undefined
  const excludedCurrentArtist = excludeArtistIds.includes(Number(id))

  const applySnapshot = (snapshot: ArtworkQuerySnapshot, seed?: number) => {
    void setQuery({ ...snapshotToQuery(snapshot, seed), artistId: null, artistLabel: null, listRevision: Date.now() })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }
  const handleApplyFilters: FilterSheetProps['onApply'] = (filters) => {
    applySnapshot(
      artworkQuerySnapshotSchema.parse({
        ...filters,
        artist: [],
        startDate: filters.startTime ? dayjs(filters.startTime).format('YYYY-MM-DD') : '',
        endDate: filters.endTime ? dayjs(filters.endTime).format('YYYY-MM-DD') : '',
        createdStartDate: filters.createdStartTime ? dayjs(filters.createdStartTime).format('YYYY-MM-DD') : '',
        createdEndDate: filters.createdEndTime ? dayjs(filters.createdEndTime).format('YYYY-MM-DD') : ''
      }),
      filters.randomSeed
    )
  }
  const clearAllFilters = () => applySnapshot(artworkQuerySnapshotSchema.parse({}))
  const immersiveViewerHref = serializeViewerQuery('/viewer', {
    ...snapshotToQuery(query, randomSeed),
    source: 'artist',
    sourceId: Number(id),
    scopeArtistId: Number(id),
    mode: query.sortBy === 'random' ? 'random' : 'ordered',
    artistId: Number(id),
    artistLabel: artist.name
  })

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
            value={query.search}
            placeholder="搜索艺术家的作品"
            ariaLabel="搜索作品或标签"
            hideArtistSuggestions
            onSearch={(value) => setQuery({ search: value.trim() || null })}
            onSuggestionClick={(suggestion) => {
              if (suggestion.type === 'tag' && suggestion.metadata?.id) {
                const tag = { value: String(suggestion.metadata.id), label: suggestion.label }
                const tags = query.tags.some((item) => item.value === tag.value) ? query.tags : [...query.tags, tag]
                applySnapshot({ ...query, search: '', tags })
              } else void setQuery({ search: suggestion.value })
            }}
            className="w-full"
          />
        </div>
      </PageToolbar>

      <GalleryFilterSheet
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        scope={scope}
        fixedArtist={fixedArtist}
        currentSearch={query.search}
        currentMediaType={query.mediaType}
        currentSortBy={query.sortBy}
        currentReadingStatus={query.readingStatus}
        currentRatingLevels={query.ratingLevels}
        currentExcludedArtists={query.excludedArtists}
        currentTags={query.tags}
        currentSources={query.sources}
        currentHasAudio={query.hasAudio}
        randomSeed={randomSeed}
        startDate={query.startDate}
        endDate={query.endDate}
        createdStartDate={query.createdStartDate}
        createdEndDate={query.createdEndDate}
        onSearchArtist={async (search) => {
          const result = await client.artist.queryPage.query({
            cursor: 1,
            pageSize: 20,
            search,
            sortBy: 'artworks_desc'
          })
          return result.data.map((artist) => ({ value: String(artist.id), label: artist.name }))
        }}
        onSearchTag={async (search) => {
          const result = await client.tag.list.query({ cursor: 1, pageSize: 20, mode: 'popular', query: search })
          return result.items.map((tag) => ({
            value: String(tag.id),
            label: tag.name_zh || tag.name_en || `#${tag.name}`
          }))
        }}
        onApply={handleApplyFilters}
        onApplySnapshot={applySnapshot}
      />

      <HeadInfo artist={artist} immersiveHref={immersiveViewerHref} />
      <PageContainer size="gallery" className="flex flex-col gap-6 py-8">
        <SectionHeader
          title="作品"
          actions={
            <Button variant="ghost" size="sm" onClick={clearAllFilters}>
              清空筛选
            </Button>
          }
        />
        <InfiniteArtworkList
          artistId={id}
          key={`${id}:${urlQuery.listRevision}`}
          queryGeneration={urlQuery.listRevision}
          searchQuery={query.search}
          sortBy={query.sortBy}
          randomSeed={randomSeed}
          mediaType={query.mediaType}
          readingStatus={query.readingStatus === 'all' ? undefined : query.readingStatus}
          ratingLevels={query.ratingLevels}
          excludeArtistIds={excludeArtistIds}
          tagIds={tagIds}
          sources={query.sources}
          hasAudio={query.hasAudio === 'all' ? undefined : query.hasAudio}
          startDate={query.startDate || undefined}
          endDate={query.endDate || undefined}
          createdStartDate={query.createdStartDate || undefined}
          createdEndDate={query.createdEndDate || undefined}
          onClearFilters={clearAllFilters}
          emptyMessage={
            excludedCurrentArtist
              ? '当前艺术家已被排除'
              : '没有作品符合当前筛选条件'
          }
          emptyDescription={excludedCurrentArtist ? '没有符合条件的作品。请调整排除艺术家条件，或清空筛选。' : undefined}
        />
      </PageContainer>
    </div>
  )
}
