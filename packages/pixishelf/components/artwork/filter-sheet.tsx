'use client'

import { useState, useEffect } from 'react'
import { SortOption, MediaTypeFilter } from '@/types'
import { Button } from '@/components/ui/button'
import { SSheet } from '@/components/shared/s-sheet'
import { SortControl } from '@/components/ui/SortControl'
import { MediaTypeFilter as MediaTypeFilterComponent } from '@/components/ui/MediaTypeFilter'
import { DatePickerRange } from '@/components/shared/date-range-picker'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import dayjs from 'dayjs'

interface FilterSheetProps {
  open: boolean
  currentMediaType: MediaTypeFilter
  currentSortBy: SortOption
  currentArtist?: Option[]
  currentTags?: Option[]
  randomSeed?: number
  startDate?: string
  endDate?: string
  onOpenChange: (open: boolean) => void
  onSearchArtist?: (value: string) => Promise<Option[]>
  onSearchTag?: (value: string) => Promise<Option[]>
  onApply: (filters: {
    mediaType: MediaTypeFilter
    sortBy: SortOption
    artist?: Option[]
    tags?: Option[]
    randomSeed?: number
    startTime?: string
    endTime?: string
  }) => void
}

export function FilterSheet(props: FilterSheetProps) {
  const {
    open,
    onOpenChange,
    currentMediaType,
    currentSortBy,
    currentArtist = [],
    currentTags = [],
    randomSeed,
    startDate,
    endDate,
    onSearchArtist,
    onSearchTag,
    onApply
  } = props

  const [localMediaType, setLocalMediaType] = useState<MediaTypeFilter>('all')
  const [localSortBy, setLocalSortBy] = useState<SortOption>('source_date_desc')
  const [localArtist, setLocalArtist] = useState<Option[]>([])
  const [localTags, setLocalTags] = useState<Option[]>([])
  const [localRandomSeed, setLocalRandomSeed] = useState<number | undefined>(undefined)
  const [localDateRange, setLocalDateRange] = useState<[Date | undefined, Date | undefined]>([undefined, undefined])

  // 当 Sheet 打开时，同步外部状态到本地
  useEffect(() => {
    if (open) {
      setLocalMediaType(currentMediaType)
      setLocalSortBy(currentSortBy)
      setLocalArtist(currentArtist)
      setLocalTags(currentTags)
      setLocalRandomSeed(randomSeed)
      setLocalDateRange([
        startDate ? dayjs(startDate).toDate() : undefined,
        endDate ? dayjs(endDate).toDate() : undefined
      ])
    } else {
      handleReset()
    }
  }, [open, currentMediaType, currentSortBy, currentArtist, currentTags, randomSeed, startDate, endDate])

  // 处理应用更改
  const handleApply = () => {
    const [start, end] = localDateRange
    // 如果是随机排序，且没有种子或用户切换到了随机排序，则生成新种子
    let seed = localRandomSeed
    if (localSortBy === 'random' && !seed) {
      seed = Math.floor(Math.random() * 1000000)
    }

    onApply({
      mediaType: localMediaType,
      sortBy: localSortBy,
      artist: localArtist,
      tags: localTags,
      randomSeed: seed,
      startTime: start ? dayjs(start).toISOString() : undefined,
      endTime: end ? dayjs(end).toISOString() : undefined
    })
    onOpenChange(false)
  }

  function handleReset() {
    setLocalMediaType('all')
    setLocalSortBy('source_date_desc')
    setLocalArtist([])
    setLocalTags([])
    setLocalRandomSeed(undefined)
    setLocalDateRange([undefined, undefined])
  }

  return (
    <SSheet
      open={open}
      onOpenChange={onOpenChange}
      side="bottom"
      className="rounded-t-[20px] sm:max-w-md sm:rounded-none sm:side-right max-h-[85vh] h-auto sm:h-full sm:max-h-screen"
      title="筛选"
      footer={
        <div className="flex w-full gap-2 ">
          <Button variant="outline" className="flex-1" onClick={handleReset}>
            重置
          </Button>
          <Button className="flex-1" onClick={handleApply}>
            确定
          </Button>
        </div>
      }
    >
      {/* 5. 中间主要内容区域 (会自动处理滚动) */}
      <div className="space-y-8">
        {/* 艺术家 */}
        {onSearchArtist && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">艺术家</h3>
            <MultipleSelector
              value={localArtist}
              defaultOptions={localArtist}
              onChange={setLocalArtist}
              onSearch={onSearchArtist}
              maxSelected={1}
              triggerSearchOnFocus
              placeholder="搜索艺术家"
              emptyIndicator="没有找到艺术家"
              className="min-h-10"
            />
          </div>
        )}

        {/* 标签 */}
        {onSearchTag && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">标签</h3>
            <MultipleSelector
              value={localTags}
              defaultOptions={localTags}
              onChange={setLocalTags}
              onSearch={onSearchTag}
              triggerSearchOnFocus
              placeholder="搜索并添加标签"
              emptyIndicator="没有找到标签"
              className="min-h-10"
            />
          </div>
        )}

        {/* 时间范围 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">时间范围</h3>
          <DatePickerRange
            value={localDateRange}
            onChange={setLocalDateRange}
            className="w-full sm:w-[240px]"
            placeholder="选择时间范围"
          />
        </div>

        {/* 排序控制 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">排序方式</h3>
          <SortControl value={localSortBy} onChange={setLocalSortBy} className="w-full" />
        </div>

        {/* 媒体类型 */}
        <div className="space-y-3">
          <h3 className="text-sm font-medium text-neutral-500 uppercase tracking-wider">媒体类型</h3>
          <MediaTypeFilterComponent
            value={localMediaType}
            onChange={setLocalMediaType}
            className="w-full justify-start"
          />
        </div>
      </div>
    </SSheet>
  )
}
