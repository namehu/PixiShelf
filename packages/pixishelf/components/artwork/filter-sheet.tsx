'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { SortOption, MediaTypeFilter, AudioFilter } from '@/types'
import type { SearchSuggestion } from '@/schemas/search.dto'
import { Button } from '@/components/ui/button'
import {
  likedRatingLevels,
  likedRatingLabels,
  resolveRatingLevels,
  type LikedRatingLevel
} from '@/schemas/artwork-filter.dto'
import { SSheet } from '@/components/shared/s-sheet'
import { SortControl } from '@/components/ui/sort-control'
import { MediaTypeFilter as MediaTypeFilterComponent } from '@/components/ui/media-type-filter'
import { DatePickerRange } from '@/components/shared/date-range-picker'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import dayjs from 'dayjs'
import { OSource } from '@/enums/e-source'
import type { ArtworkSource } from '@/schemas/models'
import {
  artworkQuerySnapshotSchema,
  readingFilterLabels,
  type ArtworkQuerySnapshot
} from '@/schemas/artwork-quick-filter.dto'
import { Slider } from '@/components/ui/slider'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'
import { SearchBox } from '@/app/artworks/_components/search-box'
import { Field, FieldGroup, FieldLabel, FieldTitle } from '@/components/ui/field'
import { useMediaQuery } from '@/hooks/use-media-query'
import type { ReadingStatus } from '@pixishelf/db/reading-contract'

export interface FilterSheetProps {
  renderFrame?: (parts: { content: ReactNode; footer: ReactNode; getSnapshot: () => ArtworkQuerySnapshot }) => ReactNode
  open: boolean
  currentMediaType: MediaTypeFilter
  currentSortBy: SortOption
  currentArtist?: Option[]
  fixedArtist?: Option
  currentExcludedArtists?: Option[]
  currentRatingLevels?: LikedRatingLevel[]
  currentTags?: Option[]
  currentSources?: ArtworkSource[]
  currentHasAudio?: AudioFilter
  currentReadingStatus?: ReadingStatus | 'all'
  currentLikedOnly?: boolean
  currentSearch?: string
  currentMaxMediaCount?: number
  resetSortBy?: SortOption
  randomSeed?: number
  startDate?: string
  endDate?: string
  createdStartDate?: string
  createdEndDate?: string
  onOpenChange: (open: boolean) => void
  onSearchArtist?: (value: string) => Promise<Option[]>
  onSearchTag?: (value: string) => Promise<Option[]>
  onApply: (filters: {
    mediaType: MediaTypeFilter
    sortBy: SortOption
    artist?: Option[]
    excludedArtists?: Option[]
    ratingLevels?: LikedRatingLevel[]
    tags?: Option[]
    sources: ArtworkSource[]
    hasAudio: AudioFilter
    readingStatus?: ReadingStatus | 'all'
    likedOnly?: boolean
    search?: string
    maxMediaCount?: number
    randomSeed?: number
    startTime?: string
    endTime?: string
    createdStartTime?: string
    createdEndTime?: string
  }) => void
}

const EMPTY_OPTIONS: Option[] = []
const EMPTY_SOURCES: ArtworkSource[] = []

export function FilterSheet(props: FilterSheetProps) {
  const isDesktop = useMediaQuery('(min-width: 640px)')
  const {
    open,
    onOpenChange,
    currentMediaType,
    currentSortBy,
    currentArtist = EMPTY_OPTIONS,
    fixedArtist,
    currentExcludedArtists = EMPTY_OPTIONS,
    currentRatingLevels,
    currentTags = EMPTY_OPTIONS,
    currentSources = EMPTY_SOURCES,
    currentHasAudio = 'all',
    currentReadingStatus,
    currentLikedOnly,
    currentSearch,
    currentMaxMediaCount,
    resetSortBy = 'source_date_desc',
    randomSeed,
    startDate,
    endDate,
    createdStartDate,
    createdEndDate,
    onSearchArtist,
    onSearchTag,
    onApply
  } = props

  const [advancedOpen, setAdvancedOpen] = useState(false)
  const [localMediaType, setLocalMediaType] = useState<MediaTypeFilter>('all')
  const [localSortBy, setLocalSortBy] = useState<SortOption>('source_date_desc')
  const [localArtist, setLocalArtist] = useState<Option[]>([])
  const [localTags, setLocalTags] = useState<Option[]>([])
  const [localSources, setLocalSources] = useState<Option[]>([])
  const [localHasAudio, setLocalHasAudio] = useState<AudioFilter>('all')
  const [localReadingStatus, setLocalReadingStatus] = useState<ReadingStatus | 'all'>('all')
  const [localRatingLevels, setLocalRatingLevels] = useState<LikedRatingLevel[]>([])
  const [localExcludedArtists, setLocalExcludedArtists] = useState<Option[]>([])
  const [localSearch, setLocalSearch] = useState('')
  const [localMaxMediaCount, setLocalMaxMediaCount] = useState(8)
  const [localRandomSeed, setLocalRandomSeed] = useState<number | undefined>(undefined)
  const [localDateRange, setLocalDateRange] = useState<[Date | undefined, Date | undefined]>([undefined, undefined])
  const [localCreatedDateRange, setLocalCreatedDateRange] = useState<[Date | undefined, Date | undefined]>([
    undefined,
    undefined
  ])

  // 当 Sheet 打开时，同步外部状态到本地
  useEffect(() => {
    if (!open) {
      return
    }

    setAdvancedOpen(Boolean(startDate || endDate || createdStartDate || createdEndDate))
    setLocalMediaType(currentMediaType)
    setLocalSortBy(currentSortBy)
    setLocalArtist(currentArtist)
    setLocalTags(currentTags)
    setLocalSources(OSource.filter((option) => currentSources.includes(option.value)))
    setLocalHasAudio(currentHasAudio)
    setLocalReadingStatus(currentReadingStatus ?? 'all')
    setLocalRatingLevels(resolveRatingLevels({ ratingLevels: currentRatingLevels, likedOnly: currentLikedOnly }))
    setLocalExcludedArtists(currentExcludedArtists)
    setLocalSearch(currentSearch ?? '')
    setLocalMaxMediaCount(currentMaxMediaCount ?? 8)
    setLocalRandomSeed(randomSeed)
    setLocalDateRange([
      startDate ? dayjs(startDate).toDate() : undefined,
      endDate ? dayjs(endDate).toDate() : undefined
    ])
    setLocalCreatedDateRange([
      createdStartDate ? dayjs(createdStartDate).toDate() : undefined,
      createdEndDate ? dayjs(createdEndDate).toDate() : undefined
    ])
  }, [
    open,
    currentMediaType,
    currentSortBy,
    currentArtist,
    currentTags,
    currentSources,
    currentHasAudio,
    currentReadingStatus,
    currentLikedOnly,
    currentRatingLevels,
    currentExcludedArtists,
    currentSearch,
    currentMaxMediaCount,
    randomSeed,
    startDate,
    endDate,
    createdStartDate,
    createdEndDate
  ])

  // 处理应用更改
  const handleApply = () => {
    const [start, end] = localDateRange
    const [createdStart, createdEnd] = localCreatedDateRange
    // 如果是随机排序，且没有种子或用户切换到了随机排序，则生成新种子
    let seed = localRandomSeed
    if (localSortBy === 'random' && seed == null) {
      seed = Math.floor(Math.random() * 1000000)
    }

    onApply({
      mediaType: localMediaType,
      sortBy: localSortBy,
      artist: fixedArtist ? [] : localArtist,
      excludedArtists: localExcludedArtists,
      ratingLevels: localRatingLevels,
      tags: localTags,
      sources: localSources.map((option) => option.value as ArtworkSource),
      hasAudio: localHasAudio,
      readingStatus: currentReadingStatus === undefined ? undefined : localReadingStatus,
      likedOnly: undefined,
      search: localSearch.trim() || undefined,
      maxMediaCount: currentMaxMediaCount === undefined ? undefined : localMaxMediaCount,
      randomSeed: seed,
      startTime: start ? dayjs(start).toISOString() : undefined,
      endTime: end ? dayjs(end).toISOString() : undefined,
      createdStartTime: createdStart ? dayjs(createdStart).toISOString() : undefined,
      createdEndTime: createdEnd ? dayjs(createdEnd).toISOString() : undefined
    })
    onOpenChange(false)
  }

  function handleReset() {
    setLocalMediaType('all')
    setLocalSortBy(resetSortBy)
    setLocalArtist([])
    setLocalTags([])
    setLocalSources([])
    setLocalHasAudio('all')
    setLocalReadingStatus('all')
    setLocalRatingLevels([])
    setLocalExcludedArtists([])
    setLocalSearch('')
    setLocalMaxMediaCount(8)
    setLocalRandomSeed(undefined)
    setLocalDateRange([undefined, undefined])
    setLocalCreatedDateRange([undefined, undefined])
  }

  const handleSuggestionClick = (suggestion: SearchSuggestion) => {
    const id = suggestion.metadata?.id
    if (suggestion.type === 'artist' && id && !fixedArtist) {
      setLocalSearch('')
      setLocalArtist([{ value: String(id), label: suggestion.label }])
      return
    }
    if (suggestion.type === 'tag' && id) {
      setLocalSearch('')
      setLocalTags((current) =>
        current.some((tag) => tag.value === String(id))
          ? current
          : [...current, { value: String(id), label: suggestion.label }]
      )
      return
    }
    setLocalSearch(suggestion.value)
  }

  const showExtendedFilters =
    props.currentSources !== undefined ||
    props.currentHasAudio !== undefined ||
    props.createdStartDate !== undefined ||
    props.createdEndDate !== undefined

  const advancedCount = Number(localDateRange.some(Boolean)) + Number(localCreatedDateRange.some(Boolean))

  const getSnapshot = () =>
    artworkQuerySnapshotSchema.parse({
      search: localSearch,
      mediaType: localMediaType,
      sortBy: localSortBy,
      artist: fixedArtist ? [] : localArtist,
      excludedArtists: localExcludedArtists,
      ratingLevels: localRatingLevels,
      tags: localTags,
      sources: localSources.map((s) => s.value),
      hasAudio: localHasAudio,
      readingStatus: localReadingStatus,

      startDate: localDateRange[0] ? dayjs(localDateRange[0]).format('YYYY-MM-DD') : '',
      endDate: localDateRange[1] ? dayjs(localDateRange[1]).format('YYYY-MM-DD') : '',
      createdStartDate: localCreatedDateRange[0] ? dayjs(localCreatedDateRange[0]).format('YYYY-MM-DD') : '',
      createdEndDate: localCreatedDateRange[1] ? dayjs(localCreatedDateRange[1]).format('YYYY-MM-DD') : ''
    })
  const footer = (
    <div className="flex w-full gap-3">
      <Button variant="outline" className="min-h-11 flex-1" onClick={handleReset}>
        重置
      </Button>
      <Button className="min-h-11 flex-[2]" onClick={handleApply}>
        应用筛选
      </Button>
    </div>
  )
  const content = (
    <FieldGroup className="gap-5 pb-4">
      {(currentRatingLevels !== undefined || currentLikedOnly !== undefined) && (
        <Field className="gap-3">
          <FieldTitle>喜欢等级</FieldTitle>
          <ToggleGroup
            type="multiple"
            variant="outline"
            aria-label="喜欢等级筛选"
            value={localRatingLevels.map(String)}
            onValueChange={(values) =>
              setLocalRatingLevels(likedRatingLevels.filter((level) => values.includes(String(level))))
            }
            className="grid w-full grid-cols-3"
          >
            {likedRatingLevels.map((level) => (
              <ToggleGroupItem key={level} value={String(level)} className="min-h-11">
                {likedRatingLabels[level]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">可多选，不选表示不限评分。</p>
        </Field>
      )}
      {currentReadingStatus !== undefined && (
        <Field className="gap-3">
          <FieldTitle>阅读状态</FieldTitle>
          <ToggleGroup
            type="single"
            variant="outline"
            aria-label="阅读状态筛选"
            value={localReadingStatus}
            onValueChange={(value) => {
              if (value in readingFilterLabels) setLocalReadingStatus(value as ReadingStatus | 'all')
            }}
            className="grid w-full grid-cols-4"
          >
            {Object.entries(readingFilterLabels).map(([value, label]) => (
              <ToggleGroupItem key={value} value={value} className="min-h-11">
                {label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>
      )}

      <Field className="gap-3">
        <FieldTitle>媒体类型</FieldTitle>
        <MediaTypeFilterComponent
          id="filter-media-type"
          aria-label="媒体类型"
          value={localMediaType}
          onChange={setLocalMediaType}
          className="w-full"
        />
        <p className="text-xs text-muted-foreground">图片包含动图；选择动图可单独查找已识别的动画作品。</p>
      </Field>
      {/* 排序控制 */}
      <Field className="gap-3">
        <FieldLabel htmlFor="filter-sort">排序方式</FieldLabel>
        <SortControl
          id="filter-sort"
          aria-label="排序方式"
          value={localSortBy}
          onChange={setLocalSortBy}
          className="w-full"
        />
      </Field>

      {currentSearch !== undefined && (
        <Field className="gap-3">
          <FieldLabel htmlFor="filter-search">关键词</FieldLabel>
          <SearchBox
            inputId="filter-search"
            inputName="filter-search"
            value={localSearch}
            onValueChange={setLocalSearch}
            onSearch={setLocalSearch}
            onSuggestionClick={handleSuggestionClick}
            hideArtistSuggestions={Boolean(fixedArtist)}
            ariaLabel={fixedArtist ? '搜索作品或标签' : '搜索作品、艺术家或标签'}
            placeholder={fixedArtist ? '搜索作品或标签' : '搜索作品、艺术家或标签'}
            className="w-full"
          />
        </Field>
      )}

      {/* 艺术家 */}
      {fixedArtist && (
        <Field className="gap-3">
          <FieldTitle>艺术家范围</FieldTitle>
          <PrivacySensitiveText className="text-sm">{fixedArtist.label}</PrivacySensitiveText>
        </Field>
      )}
      {onSearchArtist && !fixedArtist && (
        <Field className="gap-3">
          <FieldLabel htmlFor="filter-artist">艺术家</FieldLabel>
          <MultipleSelector
            showOptionValue
            inputProps={{
              id: 'filter-artist',
              name: 'filter-artist',
              autoComplete: 'off',
              'aria-label': '搜索艺术家'
            }}
            value={localArtist}
            defaultOptions={localArtist}
            onChange={setLocalArtist}
            onSearch={onSearchArtist}
            maxSelected={1}
            placeholder="搜索艺术家"
            emptyIndicator="没有找到艺术家"
            className="min-h-10"
          />
        </Field>
      )}

      {onSearchArtist && (
        <Field className="gap-3">
          <FieldLabel htmlFor="filter-excluded-artists">排除艺术家</FieldLabel>
          <MultipleSelector
            showOptionValue
            inputProps={{
              id: 'filter-excluded-artists',
              name: 'filter-excluded-artists',
              autoComplete: 'off',
              'aria-label': '搜索并排除艺术家'
            }}
            value={localExcludedArtists}
            defaultOptions={localExcludedArtists}
            onChange={setLocalExcludedArtists}
            onSearch={onSearchArtist}
            maxSelected={100}
            placeholder="搜索并排除艺术家"
            emptyIndicator="没有找到艺术家"
            className="min-h-10"
          />
          <p className="text-xs text-muted-foreground">关联任意被排除艺术家的作品均不显示，包含合作作品。</p>
        </Field>
      )}

      {/* 标签 */}
      {onSearchTag && (
        <Field className="gap-3">
          <FieldLabel htmlFor="filter-tags">标签</FieldLabel>
          <MultipleSelector
            inputProps={{
              id: 'filter-tags',
              name: 'filter-tags',
              autoComplete: 'off',
              'aria-label': '搜索并添加标签'
            }}
            value={localTags}
            defaultOptions={localTags}
            onChange={setLocalTags}
            onSearch={onSearchTag}
            placeholder="搜索并添加标签"
            emptyIndicator="没有找到标签"
            className="min-h-10"
          />
        </Field>
      )}

      {showExtendedFilters && (
        <Field className="gap-3">
          <FieldTitle>创建类型</FieldTitle>
          <ToggleGroup
            id="filter-sources"
            aria-label="创建类型筛选"
            type="multiple"
            variant="outline"
            spacing={2}
            value={localSources.map((option) => option.value)}
            onValueChange={(values) => setLocalSources(OSource.filter((option) => values.includes(option.value)))}
            className="grid w-full grid-cols-2 gap-2"
          >
            {OSource.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value} className="min-h-11">
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <p className="text-xs text-muted-foreground">可多选，不选表示全部。</p>
        </Field>
      )}

      {showExtendedFilters && (
        <Field className="gap-3">
          <FieldTitle>视频音频</FieldTitle>
          <ToggleGroup
            id="filter-audio"
            aria-label="视频音频筛选"
            type="single"
            variant="outline"
            value={localHasAudio}
            onValueChange={(value) => {
              if (value === 'all' || value === 'yes' || value === 'no') setLocalHasAudio(value)
            }}
            className="grid w-full grid-cols-3"
          >
            <ToggleGroupItem value="all" className="min-h-11">
              全部
            </ToggleGroupItem>
            <ToggleGroupItem value="yes" className="min-h-11">
              有音频
            </ToggleGroupItem>
            <ToggleGroupItem value="no" className="min-h-11">
              无音频
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>
      )}

      {currentMaxMediaCount !== undefined && (
        <Field className="gap-3">
          <div className="flex items-center justify-between">
            <FieldTitle>单个作品最多媒体数</FieldTitle>
            <span className="text-sm text-muted-foreground">{localMaxMediaCount}</span>
          </div>
          <Slider
            aria-label="单个作品最多媒体数"
            value={[localMaxMediaCount]}
            onValueChange={(value) => setLocalMaxMediaCount(value[0] ?? 8)}
            min={1}
            max={100}
            step={1}
          />
        </Field>
      )}
      <div className="flex flex-col gap-3">
        <Button
          variant="ghost"
          className="min-h-11 w-full justify-between"
          aria-expanded={advancedOpen}
          aria-controls="artwork-advanced-filters"
          onClick={() => setAdvancedOpen((value) => !value)}
        >
          更多筛选{advancedCount > 0 ? ' · ' + advancedCount + ' 项' : ''}
          <ChevronDown data-icon="inline-end" className={advancedOpen ? 'rotate-180' : undefined} />
        </Button>
        <FieldGroup id="artwork-advanced-filters" hidden={!advancedOpen} className="gap-5">
          {/* 作品原始时间范围 */}
          <Field className="gap-3">
            <FieldLabel htmlFor="filter-source-date">作品原始时间</FieldLabel>
            <DatePickerRange
              id="filter-source-date"
              aria-label="作品原始时间范围"
              value={localDateRange}
              onChange={setLocalDateRange}
              className="w-full sm:w-[240px]"
              placeholder="选择原始时间范围"
            />
          </Field>

          {showExtendedFilters && (
            <Field className="gap-3">
              <FieldLabel htmlFor="filter-created-date">入库创建时间</FieldLabel>
              <DatePickerRange
                id="filter-created-date"
                aria-label="入库创建时间范围"
                value={localCreatedDateRange}
                onChange={setLocalCreatedDateRange}
                className="w-full sm:w-[240px]"
                placeholder="选择入库时间范围"
              />
            </Field>
          )}
        </FieldGroup>
      </div>
    </FieldGroup>
  )
  if (props.renderFrame) return props.renderFrame({ content, footer, getSnapshot })
  return (
    <SSheet
      open={open}
      onOpenChange={onOpenChange}
      side={isDesktop ? 'right' : 'bottom'}
      className="h-[90dvh] max-h-[90dvh] rounded-t-[20px] sm:h-full sm:max-h-dvh sm:max-w-md sm:rounded-none [&>[data-slot=sheet-footer]]:pb-[max(1rem,env(safe-area-inset-bottom))] [&>.overflow-y-auto]:min-h-0 [&>.overflow-y-auto]:overscroll-contain"
      preventOpenAutoFocus
      title="筛选作品"
      description="选择条件后应用，关闭面板不会保存修改。"
      footer={footer}
    >
      {content}
    </SSheet>
  )
}
