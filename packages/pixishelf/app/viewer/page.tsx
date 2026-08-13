'use client'

import ImmersiveImageViewer from './_components/immersive-image-viewer'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeftIcon, SlidersHorizontal } from 'lucide-react'
import { parseAsInteger, parseAsString, useQueryStates } from 'nuqs'
import PageNoData from './_components/page-no-data'
import PageLoading from './_components/page-loading'
import PageError from './_components/page-error'
import { useViewerStore } from '@/store/viewer-store'
import { useShallow } from 'zustand/react/shallow'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useTRPC, useTRPCClient } from '@/lib/trpc'
import { EMediaType } from '@/enums/e-media-type'
import { useSafeBack } from '@/hooks/use-safe-back'
import { FilterSheet } from '@/components/artwork/filter-sheet'
import type { Option } from '@/components/shared/multiple-selector'
import type { AudioFilter, MediaTypeFilter, SortOption } from '@/types'
import { OSource } from '@/enums/e-source'
import type { ArtworkSource } from '@/schemas/models'
import dayjs from 'dayjs'
import { Button } from '@/components/ui/button'

type ViewerSource = 'all' | 'artist' | 'tag'
type ViewerMode = 'ordered' | 'random'

const viewerQueryParsers = {
  source: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: true }),
  sourceId: parseAsInteger,
  mode: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  sortBy: parseAsString.withDefault('source_date_desc').withOptions({ history: 'replace', clearOnDefault: true }),
  randomSeed: parseAsInteger,
  search: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  artistId: parseAsInteger,
  artistLabel: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  tags: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  tagLabels: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  sources: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  hasAudio: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: true }),
  mediaType: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  startDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  endDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  createdStartDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  createdEndDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true })
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

function toTagOptions(tags: string, labels: string): Option[] {
  const labelValues = decodeLabels(labels)
  return splitCsv(tags).map((id, index) => ({ value: id, label: labelValues[index] || `标签 #${id}` }))
}

function parseSources(value: string): ArtworkSource[] {
  const allowed = new Set<ArtworkSource>(OSource.map((option) => option.value))
  return splitCsv(value).filter((source): source is ArtworkSource => allowed.has(source as ArtworkSource))
}

function normalizeAudioFilter(value: string): AudioFilter {
  return value === 'yes' || value === 'no' ? value : 'all'
}

/** 沉浸式图片浏览页面。筛选状态以 URL 为准，持久化设置只作为无 URL 参数时的回退。 */
export default function ViewerPage() {
  const safeBack = useSafeBack()
  const [viewerQuery, setViewerQuery] = useQueryStates(viewerQueryParsers)
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  const trpc = useTRPC()
  const trpcClient = useTRPCClient()
  const defaultRandomSeedRef = useRef(Math.floor(Math.random() * 1000000))

  const {
    images,
    setImages,
    resetViewerState,
    maxImageCount,
    setMaxImageCount,
    mediaType,
    setMediaType,
    hasHydrated,
    isChromeHidden,
    setChromeHidden
  } = useViewerStore(
    useShallow((state) => ({
      images: state.images,
      setImages: state.setImages,
      resetViewerState: state.resetViewerState,
      maxImageCount: state.maxImageCount,
      setMaxImageCount: state.setMaxImageCount,
      mediaType: state.mediaType,
      setMediaType: state.setMediaType,
      hasHydrated: state.hasHydrated,
      isChromeHidden: state.isChromeHidden,
      setChromeHidden: state.setChromeHidden
    }))
  )

  const sourceContext = useMemo(() => {
    const sourceId = viewerQuery.sourceId ?? undefined
    const hasValidSourceId = typeof sourceId === 'number' && Number.isFinite(sourceId) && sourceId > 0
    const source: ViewerSource =
      viewerQuery.source === 'artist' || viewerQuery.source === 'tag'
        ? hasValidSourceId
          ? viewerQuery.source
          : 'all'
        : 'all'
    return { source, sourceId: source === 'all' ? undefined : sourceId }
  }, [viewerQuery.source, viewerQuery.sourceId])

  const selectedArtist = useMemo<Option[]>(() => {
    const artistId = viewerQuery.artistId ?? (sourceContext.source === 'artist' ? sourceContext.sourceId : undefined)
    return artistId ? [{ value: String(artistId), label: viewerQuery.artistLabel || `艺术家 #${artistId}` }] : []
  }, [sourceContext, viewerQuery.artistId, viewerQuery.artistLabel])

  const selectedTags = useMemo<Option[]>(() => {
    const explicit = toTagOptions(viewerQuery.tags, viewerQuery.tagLabels)
    if (explicit.length > 0) return explicit
    return sourceContext.source === 'tag' && sourceContext.sourceId
      ? [{ value: String(sourceContext.sourceId), label: `标签 #${sourceContext.sourceId}` }]
      : []
  }, [sourceContext, viewerQuery.tagLabels, viewerQuery.tags])
  const selectedSources = useMemo(() => parseSources(viewerQuery.sources), [viewerQuery.sources])
  const hasAudio = normalizeAudioFilter(viewerQuery.hasAudio)

  const feedInput = useMemo(() => {
    const requestedMode = viewerQuery.mode
    const mode: ViewerMode =
      requestedMode === 'ordered' || requestedMode === 'random'
        ? requestedMode
        : sourceContext.source === 'all'
          ? 'random'
          : 'ordered'
    const randomSeed = viewerQuery.randomSeed ?? defaultRandomSeedRef.current
    const requestedMediaType = viewerQuery.mediaType
    const effectiveMediaType = Object.values(EMediaType).includes(requestedMediaType as EMediaType)
      ? (requestedMediaType as EMediaType)
      : mediaType

    return {
      source: sourceContext.source,
      sourceId: sourceContext.sourceId,
      mode,
      sortBy: viewerQuery.sortBy || 'source_date_desc',
      randomSeed: mode === 'random' && Number.isFinite(randomSeed) ? randomSeed : undefined,
      search: viewerQuery.search || undefined,
      artistId: selectedArtist[0] ? Number(selectedArtist[0].value) : undefined,
      tagIds: selectedTags.map((tag) => Number(tag.value)).filter(Number.isFinite),
      sources: selectedSources,
      hasAudio: hasAudio === 'all' ? undefined : hasAudio,
      mediaType: effectiveMediaType,
      startDate: viewerQuery.startDate || undefined,
      endDate: viewerQuery.endDate || undefined,
      createdStartDate: viewerQuery.createdStartDate || undefined,
      createdEndDate: viewerQuery.createdEndDate || undefined,
      mediaCountMax: maxImageCount,
      pageSize: 20
    }
  }, [hasAudio, maxImageCount, mediaType, selectedArtist, selectedSources, selectedTags, sourceContext, viewerQuery])

  const feedKey = useMemo(() => JSON.stringify(feedInput), [feedInput])
  const { data, fetchNextPage, hasNextPage, isLoading, isError, error } = useInfiniteQuery(
    trpc.artwork.viewerFeed.infiniteQueryOptions(feedInput, {
      getNextPageParam: (lastPage) => lastPage.nextPage ?? undefined,
      initialCursor: 1,
      staleTime: 10 * 60 * 1000,
      gcTime: 15 * 60 * 1000,
      retry: 3,
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      enabled: hasHydrated
    })
  )

  useEffect(() => resetViewerState(), [feedKey, resetViewerState])
  useEffect(() => setImages(data?.pages.flatMap((page) => page.items) ?? []), [data, setImages])
  useEffect(() => {
    setChromeHidden(false)
    return () => setChromeHidden(false)
  }, [setChromeHidden])

  const activeFilterCount =
    Number(Boolean(viewerQuery.search)) +
    Number(selectedArtist.length > 0) +
    selectedTags.length +
    selectedSources.length +
    Number(hasAudio !== 'all') +
    Number(feedInput.mediaType !== EMediaType.all) +
    Number(Boolean(viewerQuery.startDate || viewerQuery.endDate)) +
    Number(Boolean(viewerQuery.createdStartDate || viewerQuery.createdEndDate))

  const handleSearchArtist = async (value: string): Promise<Option[]> => {
    const result = await trpcClient.artist.queryPage.query({
      cursor: 1,
      pageSize: 20,
      search: value,
      sortBy: 'artworks_desc'
    })
    return result.data.map((artist) => ({ value: String(artist.id), label: artist.name }))
  }

  const handleSearchTag = async (value: string): Promise<Option[]> => {
    const result = await trpcClient.tag.list.query({ cursor: 1, pageSize: 20, mode: 'popular', query: value })
    return result.items.map((tag) => ({
      value: String(tag.id),
      label: tag.name_zh || tag.name_en || `#${tag.name}`
    }))
  }

  const clearAllFilters = useCallback(() => {
    const randomSeed = Math.floor(Math.random() * 1000000)
    setMaxImageCount(8)
    setMediaType(EMediaType.all)
    setViewerQuery({
      source: 'all',
      sourceId: null,
      mode: 'random',
      sortBy: null,
      randomSeed,
      search: null,
      artistId: null,
      artistLabel: null,
      tags: null,
      tagLabels: null,
      sources: null,
      hasAudio: null,
      mediaType: EMediaType.all,
      startDate: null,
      endDate: null,
      createdStartDate: null,
      createdEndDate: null
    })
  }, [setMaxImageCount, setMediaType, setViewerQuery])

  const handleApplyFilters = (filters: {
    mediaType: MediaTypeFilter
    sortBy: SortOption
    artist?: Option[]
    tags?: Option[]
    sources: ArtworkSource[]
    hasAudio: AudioFilter
    randomSeed?: number
    search?: string
    maxMediaCount?: number
    startTime?: string
    endTime?: string
    createdStartTime?: string
    createdEndTime?: string
  }) => {
    const artist = filters.artist?.[0]
    const tags = filters.tags ?? []
    const isRandom = filters.sortBy === 'random'
    setMaxImageCount(filters.maxMediaCount ?? 8)
    setMediaType(filters.mediaType as EMediaType)
    setViewerQuery({
      source: 'all',
      sourceId: null,
      mode: isRandom ? 'random' : 'ordered',
      sortBy: isRandom ? null : filters.sortBy,
      randomSeed: isRandom ? (filters.randomSeed ?? Math.floor(Math.random() * 1000000)) : null,
      search: filters.search || null,
      artistId: artist ? Number(artist.value) : null,
      artistLabel: artist?.label || null,
      tags: tags.map((tag) => tag.value).join(',') || null,
      tagLabels: encodeLabels(tags) || null,
      sources: filters.sources.join(',') || null,
      hasAudio: filters.hasAudio === 'all' ? null : filters.hasAudio,
      mediaType: filters.mediaType,
      startDate: filters.startTime ? dayjs(filters.startTime).format('YYYY-MM-DD') : null,
      endDate: filters.endTime ? dayjs(filters.endTime).format('YYYY-MM-DD') : null,
      createdStartDate: filters.createdStartTime ? dayjs(filters.createdStartTime).format('YYYY-MM-DD') : null,
      createdEndDate: filters.createdEndTime ? dayjs(filters.createdEndTime).format('YYYY-MM-DD') : null
    })
  }

  return (
    <main className="relative h-dvh w-screen overflow-hidden bg-black">
      {!isChromeHidden && (
        <>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="返回"
            className="absolute top-[max(0.75rem,env(safe-area-inset-top))] left-[max(0.75rem,env(safe-area-inset-left))] z-50 size-11 rounded-full bg-black/45 text-white backdrop-blur-md hover:bg-black/65 hover:text-white"
            onClick={safeBack}
          >
            <ChevronLeftIcon aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={activeFilterCount > 0 ? `筛选，已启用 ${activeFilterCount} 项` : '筛选'}
            className="absolute top-[max(0.75rem,env(safe-area-inset-top))] right-[max(0.75rem,env(safe-area-inset-right))] z-50 size-11 rounded-full bg-black/45 text-white backdrop-blur-md hover:bg-black/65 hover:text-white"
            onClick={() => setIsFilterOpen(true)}
          >
            <SlidersHorizontal aria-hidden="true" />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[11px] leading-5 font-semibold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
        </>
      )}

      {isError ? (
        <PageError content={error?.message || '无法加载图片数据，请检查网络连接'} />
      ) : isLoading && !data ? (
        <PageLoading />
      ) : !images.length ? (
        <PageNoData
          hasActiveFilters={activeFilterCount > 0}
          onAdjustFilters={() => setIsFilterOpen(true)}
          onClearFilters={clearAllFilters}
        />
      ) : (
        <ImmersiveImageViewer
          initialImages={images}
          onLoadMore={fetchNextPage}
          hasMore={!!hasNextPage}
          isLoading={isLoading}
          interactionLocked={isFilterOpen}
        />
      )}

      <FilterSheet
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        currentSearch={viewerQuery.search}
        currentMediaType={feedInput.mediaType as MediaTypeFilter}
        currentSortBy={(feedInput.mode === 'random' ? 'random' : feedInput.sortBy) as SortOption}
        currentArtist={selectedArtist}
        currentTags={selectedTags}
        currentSources={selectedSources}
        currentHasAudio={hasAudio}
        currentMaxMediaCount={maxImageCount}
        resetSortBy="random"
        randomSeed={feedInput.randomSeed}
        startDate={viewerQuery.startDate}
        endDate={viewerQuery.endDate}
        createdStartDate={viewerQuery.createdStartDate}
        createdEndDate={viewerQuery.createdEndDate}
        onSearchArtist={handleSearchArtist}
        onSearchTag={handleSearchTag}
        onApply={handleApplyFilters}
      />
    </main>
  )
}
