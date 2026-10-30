'use client'

import Link from 'next/link'
import {
  queryRatingLevels,
  queryArtistOptions,
  queryMediaKinds,
  queryReadingStatuses
} from '@/lib/artwork-query-snapshot'
import {
  likedRatingLabels,
  mediaKindLabels,
  readingStatusLabels,
  type MediaKind,
  type LikedRatingLevel
} from '@/schemas/artwork-filter.dto'
import { useSearchParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageUpIcon, SlidersHorizontal, X } from 'lucide-react'
import { SortOption, AudioFilter } from '@/types'
import type { SearchSuggestion } from '@/schemas/search.dto'
import { SearchBox } from './_components/search-box'
import { GalleryFilterSheet } from '@/components/artwork/gallery-filter-sheet'
import { artworkQueryParsers, snapshotToQuery } from '@/lib/artwork-query-snapshot'
import { artworkQuerySnapshotSchema, type ArtworkQuerySnapshot } from '@/schemas/artwork-quick-filter.dto'
import { toast } from 'sonner'
import { PageContainer } from '@/components/layout/page-container'
import PageToolbar from '@/components/layout/page-toolbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import InfiniteArtworkList from '@/components/artwork/infinite-artwork-list'
import { createSerializer, useQueryStates, parseAsBoolean, parseAsInteger, parseAsString } from 'nuqs'
import dayjs from 'dayjs'
import type { Option } from '@/components/shared/multiple-selector'
import { useTRPCClient } from '@/lib/trpc'
import { MSource, OSource } from '@/enums/e-source'
import type { ArtworkSource } from '@/schemas/models'
import type { ReadingStatus } from '@pixishelf/db/reading-contract'

const searchParamsParsers = {
  ...artworkQueryParsers,
  // Keep the list cache identity when navigating back from a reading page.
  listRevision: parseAsInteger.withDefault(0)
}

const viewerQueryParsers = {
  source: parseAsString,
  sourceId: parseAsInteger,
  mode: parseAsString,
  sortBy: parseAsString,
  randomSeed: parseAsInteger,
  search: parseAsString,
  artistId: parseAsInteger,
  artistLabel: parseAsString,
  tags: parseAsString,
  tagLabels: parseAsString,
  sources: parseAsString,
  hasAudio: parseAsString,
  readingStatus: parseAsString,
  readingStatuses: parseAsString,
  likedOnly: parseAsBoolean,
  ratingLevels: parseAsString,
  excludeArtistIds: parseAsString,
  excludeArtistLabels: parseAsString,
  mediaType: parseAsString,
  mediaKinds: parseAsString,
  startDate: parseAsString,
  endDate: parseAsString,
  createdStartDate: parseAsString,
  createdEndDate: parseAsString
}

const serializeViewerQuery = createSerializer(viewerQueryParsers)

const SORT_LABELS: Record<SortOption, string> = {
  source_date_desc: '原始时间 ↓',
  source_date_asc: '原始时间 ↑',
  created_at_desc: '入库时间 ↓',
  created_at_asc: '入库时间 ↑',
  title_asc: '标题 A-Z',
  title_desc: '标题 Z-A',
  artist_asc: '艺术家 A-Z',
  artist_desc: '艺术家 Z-A',
  images_desc: '图片数量 ↓',
  images_asc: '图片数量 ↑',
  random: '随机排序'
}

const AUDIO_FILTER_LABELS: Record<Exclude<AudioFilter, 'all'>, string> = {
  yes: '有音频',
  no: '无音频'
}

function splitCsv(value: string) {
  return value.split(',').filter(Boolean)
}

function decodeLabels(value: string) {
  return splitCsv(value).map((item) => {
    try {
      return decodeURIComponent(item)
    } catch {
      return item
    }
  })
}

function encodeLabels(options: Option[]) {
  return options.map((item) => encodeURIComponent(item.label)).join(',')
}

function parseSources(value: string): ArtworkSource[] {
  const allowedSources = new Set<ArtworkSource>(OSource.map((option) => option.value))
  return splitCsv(value).filter((source): source is ArtworkSource => allowedSources.has(source as ArtworkSource))
}

function normalizeAudioFilter(value?: string | null): AudioFilter {
  return value === 'yes' || value === 'no' ? value : 'all'
}

function toTagOptions(tags: string, tagLabels: string): Option[] {
  const ids = splitCsv(tags)
  const labels = decodeLabels(tagLabels)
  return ids.map((id, index) => ({
    value: id,
    label: labels[index] || `#${id}`
  }))
}

export default function GalleryPage() {
  const trpcClient = useTRPCClient()
  const [queryStates, setQueryStates] = useQueryStates(searchParamsParsers)
  const defaultRandomSeedRef = useRef(Math.floor(Math.random() * 1000000))
  const {
    search: searchQuery,
    sortBy,
    randomSeed,
    mediaType: mediaTypeParam,
    mediaKinds: mediaKindsParam,
    startDate,
    endDate,
    createdStartDate,
    createdEndDate,
    artistId,
    artistLabel,
    tags,
    tagLabels,
    sources,
    hasAudio: hasAudioParam,
    readingStatus: readingStatusParam,
    readingStatuses: readingStatusesParam,
    likedOnly,
    ratingLevels: ratingLevelsParam,
    excludeArtistIds,
    excludeArtistLabels,
    listRevision
  } = queryStates
  const ratingLevels = useMemo(() => queryRatingLevels(ratingLevelsParam, likedOnly), [ratingLevelsParam, likedOnly])
  const excludedArtists = useMemo(
    () => queryArtistOptions(excludeArtistIds, excludeArtistLabels),
    [excludeArtistIds, excludeArtistLabels]
  )
  const excludedIds = useMemo(() => excludedArtists.map((artist) => Number(artist.value)), [excludedArtists])
  const hasAudio = normalizeAudioFilter(hasAudioParam)
  const readingStatuses = useMemo(
    () => queryReadingStatuses(readingStatusesParam, readingStatusParam),
    [readingStatusesParam, readingStatusParam]
  )
  const mediaKinds = useMemo(() => queryMediaKinds(mediaKindsParam, mediaTypeParam), [mediaKindsParam, mediaTypeParam])
  const effectiveRandomSeed = randomSeed != null ? Number(randomSeed) : defaultRandomSeedRef.current

  // 控制筛选抽屉的开关
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const [filterTab, setFilterTab] = useState<'conditions' | 'saved'>('conditions')
  const navigationParams = useSearchParams()
  // Consume navigation commands from Next's committed URL, not nuqs' optimistic state.
  // Otherwise a pending router.push can restore a command after nuqs clears it.
  useEffect(() => {
    const manage = navigationParams.get('quickFilters') === 'manage'
    const apply = navigationParams.has('quickApply')
    if (!manage && !apply) return
    if (manage) {
      setFilterTab('saved')
      setIsFilterOpen(true)
    }
    const url = new URL(window.location.href)
    if (apply) {
      url.searchParams.set('listRevision', String(Date.now()))
      window.scrollTo({ top: 0, behavior: 'instant' })
    }
    url.searchParams.delete('quickFilters')
    url.searchParams.delete('quickApply')
    // Let Next preserve its own history state and notify nuqs of the new revision.
    // Passing Next's internal markers back would bypass that notification.
    window.history.replaceState(null, '', url.pathname + url.search + url.hash)
  }, [navigationParams])
  const applySnapshot = (query: ArtworkQuerySnapshot) => {
    void setQueryStates({ ...snapshotToQuery(query), listRevision: Date.now() })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  const selectedArtist = useMemo<Option[]>(
    () => (artistId ? [{ value: artistId.toString(), label: artistLabel || `艺术家 #${artistId}` }] : []),
    [artistId, artistLabel]
  )
  const selectedTags = useMemo<Option[]>(() => toTagOptions(tags, tagLabels), [tags, tagLabels])
  const selectedSources = useMemo(() => parseSources(sources), [sources])
  const tagIds = useMemo(() => selectedTags.map((tag) => Number(tag.value)).filter(Number.isFinite), [selectedTags])
  const hasActiveFilters =
    !!searchQuery ||
    !!artistId ||
    selectedTags.length > 0 ||
    selectedSources.length > 0 ||
    hasAudio !== 'all' ||
    readingStatuses.length > 0 ||
    ratingLevels.length > 0 ||
    excludedArtists.length > 0 ||
    mediaKinds.length > 0 ||
    !!startDate ||
    !!endDate ||
    !!createdStartDate ||
    !!createdEndDate ||
    sortBy !== 'source_date_desc'

  const immersiveViewerHref = useMemo(() => {
    const randomSeedValue = effectiveRandomSeed
    const firstTagId = tagIds[0]
    const source = artistId ? 'artist' : firstTagId ? 'tag' : 'all'
    const sourceId = artistId || firstTagId || null

    return serializeViewerQuery('/viewer', {
      source,
      sourceId,
      mode: sortBy === 'random' ? 'random' : 'ordered',
      sortBy: sortBy === 'random' ? null : sortBy || 'source_date_desc',
      randomSeed: sortBy === 'random' && Number.isFinite(randomSeedValue) ? randomSeedValue : null,
      search: searchQuery || null,
      artistId: artistId || null,
      artistLabel: artistId ? artistLabel || null : null,
      tags: tagIds.join(',') || null,
      tagLabels: selectedTags.length > 0 ? encodeLabels(selectedTags) : null,
      sources: selectedSources.join(',') || null,
      hasAudio: hasAudio === 'all' ? null : hasAudio,
      readingStatuses: readingStatuses.join(','),
      ratingLevels: ratingLevels.join(',') || null,
      excludeArtistIds: excludeArtistIds || null,
      excludeArtistLabels: excludeArtistLabels || null,
      mediaKinds: mediaKinds.join(','),
      startDate: startDate || null,
      endDate: endDate || null,
      createdStartDate: createdStartDate || null,
      createdEndDate: createdEndDate || null
    })
  }, [
    artistId,
    artistLabel,
    createdEndDate,
    createdStartDate,
    endDate,
    hasAudio,
    readingStatuses,
    ratingLevels,
    excludeArtistIds,
    excludeArtistLabels,
    mediaKinds,
    effectiveRandomSeed,
    searchQuery,
    selectedSources,
    selectedTags,
    sortBy,
    startDate,
    tagIds
  ])

  const handleSearchArtist = async (value: string): Promise<Option[]> => {
    const res = await trpcClient.artist.queryPage.query({
      cursor: 1,
      pageSize: 20,
      search: value,
      sortBy: 'artworks_desc'
    })

    return res.data.map((artist) => ({
      value: artist.id.toString(),
      label: artist.name
    }))
  }

  const handleSearchTag = async (value: string): Promise<Option[]> => {
    const res = await trpcClient.tag.list.query({
      cursor: 1,
      pageSize: 20,
      mode: 'popular',
      query: value
    })

    return res.items.map((tag) => ({
      value: tag.id.toString(),
      label: tag.name_zh || tag.name_en || `#${tag.name}`
    }))
  }

  const handleSearch = (query: string) => {
    setQueryStates({ search: query.trim() || null })
  }

  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    const id = suggestion.metadata?.id

    if (suggestion.type === 'artist' && id) {
      setQueryStates({
        search: null,
        artistId: id,
        artistLabel: suggestion.label
      })
      return
    }

    if (suggestion.type === 'tag' && id) {
      const nextTags = selectedTags.some((tag) => tag.value === id.toString())
        ? selectedTags
        : [...selectedTags, { value: id.toString(), label: suggestion.label }]

      setQueryStates({
        search: null,
        tags: nextTags.map((tag) => tag.value).join(',') || null,
        tagLabels: encodeLabels(nextTags) || null
      })
      return
    }

    setQueryStates({ search: suggestion.value.trim() || null })
  }

  const updateSelectedArtist = (options: Option[]) => {
    const selected = options[0]
    setQueryStates({
      artistId: selected ? Number(selected.value) : null,
      artistLabel: selected?.label || null
    })
  }

  const updateSelectedTags = (options: Option[]) => {
    setQueryStates({
      tags: options.map((tag) => tag.value).join(',') || null,
      tagLabels: encodeLabels(options) || null
    })
  }

  const handleApplyFilters = (filters?: {
    mediaKinds: MediaKind[]
    sortBy: SortOption
    artist?: Option[]
    tags?: Option[]
    randomSeed?: number
    startTime?: string
    endTime?: string
    createdStartTime?: string
    createdEndTime?: string
    sources: ArtworkSource[]
    hasAudio: AudioFilter
    readingStatuses?: ReadingStatus[]
    likedOnly?: boolean
    ratingLevels?: LikedRatingLevel[]
    excludedArtists?: Option[]
    search?: string
  }) => {
    if (!filters) {
      return clearAllFilters()
    }

    const result = artworkQuerySnapshotSchema.safeParse({
      ...filters,
      startDate: filters.startTime ? dayjs(filters.startTime).format('YYYY-MM-DD') : '',
      endDate: filters.endTime ? dayjs(filters.endTime).format('YYYY-MM-DD') : '',
      createdStartDate: filters.createdStartTime ? dayjs(filters.createdStartTime).format('YYYY-MM-DD') : '',
      createdEndDate: filters.createdEndTime ? dayjs(filters.createdEndTime).format('YYYY-MM-DD') : ''
    })
    if (!result.success) {
      toast.error('筛选条件无效，请检查日期范围。')
      return
    }
    void setQueryStates({ ...snapshotToQuery(result.data, filters.randomSeed), listRevision: Date.now() })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }

  const clearAllFilters = () => {
    setQueryStates({
      search: null,
      sortBy: null,
      randomSeed: null,
      mediaType: null,
      mediaKinds: '',
      startDate: null,
      endDate: null,
      createdStartDate: null,
      createdEndDate: null,
      artistId: null,
      artistLabel: null,
      tags: null,
      tagLabels: null,
      sources: null,
      hasAudio: null,
      readingStatus: null,
      readingStatuses: '',
      likedOnly: null,
      ratingLevels: null,
      excludeArtistIds: null,
      excludeArtistLabels: null
    })
  }

  const removeTag = (value: string) => {
    updateSelectedTags(selectedTags.filter((tag) => tag.value !== value))
  }

  return (
    <div className="min-h-dvh bg-background">
      <PageToolbar
        containerSize="gallery"
        title={
          <h1 className="sr-only items-center gap-2 text-base font-semibold text-foreground md:not-sr-only md:flex">
            作品
          </h1>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" asChild className="size-11 px-0 sm:h-9 sm:w-auto sm:px-3">
              <Link href={immersiveViewerHref} aria-label="沉浸浏览">
                <ImageUpIcon data-icon="inline-start" aria-hidden="true" />
                <span className="hidden sm:inline">沉浸浏览</span>
              </Link>
            </Button>
            <Button
              variant={hasActiveFilters ? 'secondary' : 'outline'}
              aria-label="筛选作品"
              onClick={() => setIsFilterOpen(true)}
              className="size-11 px-0 sm:h-9 sm:w-auto sm:px-3"
            >
              <SlidersHorizontal data-icon="inline-start" aria-hidden="true" />
              <span className="hidden sm:inline">筛选</span>
            </Button>
          </div>
        }
      >
        <SearchBox
          value={searchQuery}
          onSearch={handleSearch}
          onSuggestionClick={handleSuggestionClick}
          className="w-full"
        />
      </PageToolbar>

      {hasActiveFilters && (
        <div className="border-b border-border bg-surface-raised/70">
          <PageContainer size="gallery" className="py-2.5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="h-7 rounded-full px-3 text-xs font-normal">
                当前筛选
              </Badge>
              {searchQuery && (
                <FilterChip label={`关键词：${searchQuery}`} onRemove={() => setQueryStates({ search: null })} />
              )}
              {artistId && (
                <FilterChip label={`艺术家：${artistLabel || artistId}`} onRemove={() => updateSelectedArtist([])} />
              )}
              {selectedTags.map((tag) => (
                <FilterChip key={tag.value} label={`标签：${tag.label}`} onRemove={() => removeTag(tag.value)} />
              ))}
              {selectedSources.map((source) => (
                <FilterChip
                  key={source}
                  label={`创建类型：${MSource[source]}`}
                  onRemove={() =>
                    setQueryStates({ sources: selectedSources.filter((item) => item !== source).join(',') || null })
                  }
                />
              ))}
              {hasAudio !== 'all' && (
                <FilterChip
                  label={`视频音频：${AUDIO_FILTER_LABELS[hasAudio]}`}
                  onRemove={() => setQueryStates({ hasAudio: null })}
                />
              )}
              {ratingLevels.map((level) => (
                <FilterChip
                  key={level}
                  label={likedRatingLabels[level]}
                  onRemove={() =>
                    setQueryStates({
                      likedOnly: null,
                      ratingLevels: ratingLevels.filter((value) => value !== level).join(',') || null
                    })
                  }
                />
              ))}
              {excludedArtists.map((artist) => (
                <FilterChip
                  key={`exclude-${artist.value}`}
                  label={`排除：${artist.label}`}
                  onRemove={() => {
                    const remaining = excludedArtists.filter((item) => item.value !== artist.value)
                    void setQueryStates({
                      excludeArtistIds: remaining.map((item) => item.value).join(',') || null,
                      excludeArtistLabels: encodeLabels(remaining) || null
                    })
                  }}
                />
              ))}
              {readingStatuses.map((status) => (
                <FilterChip
                  key={status}
                  label={`阅读状态：${readingStatusLabels[status]}`}
                  onRemove={() =>
                    setQueryStates({
                      readingStatus: null,
                      readingStatuses: readingStatuses.filter((value) => value !== status).join(',')
                    })
                  }
                />
              ))}
              {mediaKinds.map((kind) => (
                <FilterChip
                  key={kind}
                  label={mediaKindLabels[kind]}
                  onRemove={() =>
                    setQueryStates({
                      mediaType: null,
                      mediaKinds: mediaKinds.filter((value) => value !== kind).join(',')
                    })
                  }
                />
              ))}
              {(startDate || endDate) && (
                <FilterChip
                  label={`原始时间：${startDate || '不限'} - ${endDate || '不限'}`}
                  onRemove={() => setQueryStates({ startDate: null, endDate: null })}
                />
              )}
              {(createdStartDate || createdEndDate) && (
                <FilterChip
                  label={`入库时间：${createdStartDate || '不限'} - ${createdEndDate || '不限'}`}
                  onRemove={() => setQueryStates({ createdStartDate: null, createdEndDate: null })}
                />
              )}
              {sortBy !== 'source_date_desc' && (
                <FilterChip
                  label={`排序：${SORT_LABELS[sortBy as SortOption] || sortBy}`}
                  onRemove={() => setQueryStates({ sortBy: null, randomSeed: null })}
                />
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={clearAllFilters}
              >
                清空全部
              </Button>
            </div>
          </PageContainer>
        </div>
      )}

      <GalleryFilterSheet
        initialTab={filterTab}
        onApplySnapshot={applySnapshot}
        currentSearch={searchQuery}
        open={isFilterOpen}
        onOpenChange={(open) => {
          setIsFilterOpen(open)
          if (!open) setFilterTab('conditions')
        }}
        currentMediaKinds={mediaKinds}
        currentSortBy={sortBy as SortOption}
        currentArtist={selectedArtist}
        currentTags={selectedTags}
        currentSources={selectedSources}
        currentHasAudio={hasAudio}
        currentReadingStatuses={readingStatuses}
        currentRatingLevels={ratingLevels}
        currentExcludedArtists={excludedArtists}
        randomSeed={sortBy === 'random' ? effectiveRandomSeed : undefined}
        startDate={startDate}
        endDate={endDate}
        createdStartDate={createdStartDate}
        createdEndDate={createdEndDate}
        onSearchArtist={handleSearchArtist}
        onSearchTag={handleSearchTag}
        onApply={handleApplyFilters}
      />

      <PageContainer as="main" size="gallery" className="pt-4 pb-10 sm:pt-6">
        <InfiniteArtworkList
          key={listRevision}
          queryGeneration={listRevision}
          searchQuery={searchQuery}
          sortBy={sortBy as SortOption}
          mediaKinds={mediaKinds}
          tagIds={tagIds}
          artistId={artistId || undefined}
          sources={selectedSources}
          hasAudio={hasAudio === 'all' ? undefined : hasAudio}
          readingStatuses={readingStatuses}
          ratingLevels={ratingLevels}
          excludeArtistIds={excludedIds}
          randomSeed={sortBy === 'random' ? effectiveRandomSeed : undefined}
          startDate={startDate || undefined}
          endDate={endDate || undefined}
          createdStartDate={createdStartDate || undefined}
          createdEndDate={createdEndDate || undefined}
          onClearFilters={clearAllFilters}
        />
      </PageContainer>
    </div>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <Badge variant="secondary" className="h-7 rounded-full gap-1.5 pl-3 pr-1 text-xs font-normal">
      <span className="max-w-[220px] truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`移除筛选：${label}`}
        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="size-3.5" aria-hidden="true" />
      </button>
    </Badge>
  )
}
