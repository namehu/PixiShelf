'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ImageUpIcon, SlidersHorizontal, X } from 'lucide-react'
import { SortOption, MediaTypeFilter, AudioFilter } from '@/types'
import type { SearchSuggestion } from '@/schemas/search.dto'
import { SearchBox } from './_components/search-box'
import { FilterSheet } from '@/components/artwork/filter-sheet'
import { PageContainer } from '@/components/layout/page-container'
import PageToolbar from '@/components/layout/page-toolbar'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import InfiniteArtworkList from '@/components/artwork/infinite-artwork-list'
import { createSerializer, useQueryStates, parseAsInteger, parseAsString } from 'nuqs'
import dayjs from 'dayjs'
import type { Option } from '@/components/shared/multiple-selector'
import { useTRPCClient } from '@/lib/trpc'
import { MSource, OSource } from '@/enums/e-source'
import type { ArtworkSource } from '@/schemas/models'

const searchParamsParsers = {
  search: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  sortBy: parseAsString.withDefault('source_date_desc').withOptions({ history: 'replace', clearOnDefault: true }),
  randomSeed: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  mediaType: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: true }),
  startDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  endDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  createdStartDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  createdEndDate: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  artistId: parseAsInteger.withOptions({ history: 'replace', clearOnDefault: true }),
  artistLabel: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  tags: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  tagLabels: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  sources: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true }),
  hasAudio: parseAsString.withDefault('all').withOptions({ history: 'replace', clearOnDefault: true })
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
  mediaType: parseAsString,
  startDate: parseAsString,
  endDate: parseAsString,
  createdStartDate: parseAsString,
  createdEndDate: parseAsString
}

const serializeViewerQuery = createSerializer(viewerQueryParsers)

const MEDIA_TYPE_LABELS: Record<MediaTypeFilter, string> = {
  all: '全部类型',
  image: '仅图片',
  video: '仅视频'
}

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
  const {
    search: searchQuery,
    sortBy,
    randomSeed,
    mediaType,
    startDate,
    endDate,
    createdStartDate,
    createdEndDate,
    artistId,
    artistLabel,
    tags,
    tagLabels,
    sources,
    hasAudio: hasAudioParam
  } = queryStates
  const hasAudio = normalizeAudioFilter(hasAudioParam)

  // 控制筛选抽屉的开关
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  // 用于显示总数的本地状态
  const [total, setTotal] = useState(0)

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
    mediaType !== 'all' ||
    !!startDate ||
    !!endDate ||
    !!createdStartDate ||
    !!createdEndDate ||
    sortBy !== 'source_date_desc'

  const immersiveViewerHref = useMemo(() => {
    const randomSeedValue = randomSeed ? Number(randomSeed) : null
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
      mediaType: mediaType || 'all',
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
    mediaType,
    randomSeed,
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
    mediaType: MediaTypeFilter
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
  }) => {
    if (!filters) {
      return clearAllFilters()
    }

    setQueryStates({
      mediaType: filters.mediaType,
      sortBy: filters.sortBy,
      artistId: filters.artist?.[0] ? Number(filters.artist[0].value) : null,
      artistLabel: filters.artist?.[0]?.label || null,
      tags: filters.tags?.map((tag) => tag.value).join(',') || null,
      tagLabels: filters.tags ? encodeLabels(filters.tags) || null : null,
      randomSeed: filters.randomSeed ? filters.randomSeed.toString() : null,
      startDate: filters.startTime ? dayjs(filters.startTime).format('YYYY-MM-DD') : null,
      endDate: filters.endTime ? dayjs(filters.endTime).format('YYYY-MM-DD') : null,
      createdStartDate: filters.createdStartTime ? dayjs(filters.createdStartTime).format('YYYY-MM-DD') : null,
      createdEndDate: filters.createdEndTime ? dayjs(filters.createdEndTime).format('YYYY-MM-DD') : null,
      sources: filters.sources.join(',') || null,
      hasAudio: filters.hasAudio === 'all' ? null : filters.hasAudio
    })
  }

  const clearAllFilters = () => {
    setQueryStates({
      search: null,
      sortBy: null,
      randomSeed: null,
      mediaType: null,
      startDate: null,
      endDate: null,
      createdStartDate: null,
      createdEndDate: null,
      artistId: null,
      artistLabel: null,
      tags: null,
      tagLabels: null,
      sources: null,
      hasAudio: null
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
            {total > 0 && (
              <span className="font-utility text-xs font-normal text-muted-foreground" aria-live="polite">
                {total.toLocaleString()}
              </span>
            )}
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
              {mediaType !== 'all' && (
                <FilterChip
                  label={MEDIA_TYPE_LABELS[mediaType as MediaTypeFilter]}
                  onRemove={() => setQueryStates({ mediaType: null })}
                />
              )}
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

      <FilterSheet
        open={isFilterOpen}
        onOpenChange={setIsFilterOpen}
        currentMediaType={mediaType as MediaTypeFilter}
        currentSortBy={sortBy as SortOption}
        currentArtist={selectedArtist}
        currentTags={selectedTags}
        currentSources={selectedSources}
        currentHasAudio={hasAudio}
        randomSeed={randomSeed ? Number(randomSeed) : undefined}
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
          searchQuery={searchQuery}
          sortBy={sortBy as SortOption}
          mediaType={mediaType as MediaTypeFilter}
          tagIds={tagIds}
          artistId={artistId || undefined}
          sources={selectedSources}
          hasAudio={hasAudio === 'all' ? undefined : hasAudio}
          randomSeed={randomSeed ? Number(randomSeed) : undefined}
          startDate={startDate || undefined}
          endDate={endDate || undefined}
          createdStartDate={createdStartDate || undefined}
          createdEndDate={createdEndDate || undefined}
          onTotalChange={setTotal}
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
