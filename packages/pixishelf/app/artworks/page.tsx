'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { ImageUpIcon, SlidersHorizontal, X } from 'lucide-react'
import { SortOption, MediaTypeFilter } from '@/types'
import type { SearchSuggestion } from '@/schemas/search.dto'
import { SearchBox } from './_components/search-box'
import { FilterSheet } from '@/components/artwork/filter-sheet'
import PNav from '@/components/layout/PNav'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import InfiniteArtworkList from '@/components/artwork/Infinite-artwork-list'
import { createSerializer, useQueryStates, parseAsInteger, parseAsString } from 'nuqs'
import dayjs from 'dayjs'
import type { Option } from '@/components/shared/multiple-selector'
import { useTRPCClient } from '@/lib/trpc'

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
  tagLabels: parseAsString.withDefault('').withOptions({ history: 'replace', clearOnDefault: true })
}

const viewerQueryParsers = {
  source: parseAsString,
  sourceId: parseAsInteger,
  mode: parseAsString,
  sortBy: parseAsString,
  randomSeed: parseAsInteger,
  search: parseAsString,
  mediaType: parseAsString,
  startDate: parseAsString,
  endDate: parseAsString
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
    tagLabels
  } = queryStates

  // 控制筛选抽屉的开关
  const [isFilterOpen, setIsFilterOpen] = useState(false)
  // 用于显示总数的本地状态
  const [total, setTotal] = useState(0)

  const selectedArtist = useMemo<Option[]>(
    () => (artistId ? [{ value: artistId.toString(), label: artistLabel || `艺术家 #${artistId}` }] : []),
    [artistId, artistLabel]
  )
  const selectedTags = useMemo<Option[]>(() => toTagOptions(tags, tagLabels), [tags, tagLabels])
  const tagIds = useMemo(() => selectedTags.map((tag) => Number(tag.value)).filter(Number.isFinite), [selectedTags])
  const hasActiveFilters =
    !!searchQuery ||
    !!artistId ||
    selectedTags.length > 0 ||
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
      mediaType: mediaType && mediaType !== 'all' ? mediaType : null,
      startDate: startDate || null,
      endDate: endDate || null
    })
  }, [artistId, endDate, mediaType, randomSeed, searchQuery, sortBy, startDate, tagIds])

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
      createdEndDate: filters.createdEndTime ? dayjs(filters.createdEndTime).format('YYYY-MM-DD') : null
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
      tagLabels: null
    })
  }

  const removeTag = (value: string) => {
    updateSelectedTags(selectedTags.filter((tag) => tag.value !== value))
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
              <span className="hidden sm:inline">筛选</span>
            </Button>
          </div>
        }
      >
        <SearchBox
          value={searchQuery}
          onSearch={handleSearch}
          onSuggestionClick={handleSuggestionClick}
          className="w-full shadow-sm"
        />
      </PNav>

      {/* 2. 顶部工具栏 (Sticky) */}
      <div className="px-4 sticky top-[64px] z-30 py-3 transition-all backdrop-blur-xl bg-white/85 border-b border-gray-100/80">
        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-bold text-neutral-900 flex items-center gap-2">
              画廊
              {total > 0 && (
                <Badge variant="secondary" className="rounded-full font-normal">
                  {total.toLocaleString()}
                </Badge>
              )}
              {hasActiveFilters && (
                <Badge variant="outline" className="rounded-full font-normal text-xs">
                  已筛选
                </Badge>
              )}
            </h1>
          </div>
        </div>

        {hasActiveFilters && (
          <div className="mt-3 flex flex-wrap gap-2">
            {searchQuery && (
              <FilterChip label={`关键词：${searchQuery}`} onRemove={() => setQueryStates({ search: null })} />
            )}
            {artistId && (
              <FilterChip label={`艺术家：${artistLabel || artistId}`} onRemove={() => updateSelectedArtist([])} />
            )}
            {selectedTags.map((tag) => (
              <FilterChip key={tag.value} label={`标签：${tag.label}`} onRemove={() => removeTag(tag.value)} />
            ))}
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
            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-neutral-500" onClick={clearAllFilters}>
              清空全部
            </Button>
          </div>
        )}

        <FilterSheet
          open={isFilterOpen}
          onOpenChange={setIsFilterOpen}
          currentMediaType={mediaType as MediaTypeFilter}
          currentSortBy={sortBy as SortOption}
          currentArtist={selectedArtist}
          currentTags={selectedTags}
          randomSeed={randomSeed ? Number(randomSeed) : undefined}
          startDate={startDate}
          endDate={endDate}
          createdStartDate={createdStartDate}
          createdEndDate={createdEndDate}
          onSearchArtist={handleSearchArtist}
          onSearchTag={handleSearchTag}
          onApply={handleApplyFilters}
        />
      </div>

      <main className="container mx-auto pb-10 px-4">
        {/* 3. 虚拟滚动列表 */}
        <InfiniteArtworkList
          searchQuery={searchQuery}
          sortBy={sortBy as SortOption}
          mediaType={mediaType as MediaTypeFilter}
          tagIds={tagIds}
          artistId={artistId || undefined}
          randomSeed={randomSeed ? Number(randomSeed) : undefined}
          startDate={startDate || undefined}
          endDate={endDate || undefined}
          createdStartDate={createdStartDate || undefined}
          createdEndDate={createdEndDate || undefined}
          onTotalChange={setTotal}
          onClearFilters={clearAllFilters}
        />
      </main>
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
        className="inline-flex size-5 items-center justify-center rounded-full text-neutral-500 hover:bg-neutral-200 hover:text-neutral-900"
      >
        <X className="size-3" />
      </button>
    </Badge>
  )
}
