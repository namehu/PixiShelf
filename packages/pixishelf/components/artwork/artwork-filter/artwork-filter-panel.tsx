'use client'

import { Dispatch, SetStateAction, useId } from 'react'
import { Search, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { ProDatePicker, ProDatePickerPresets } from '@/components/shared/pro-date-picker'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ArtworkFilterValue } from './artwork-filter-types'
import { normalizeAudioFilter } from './artwork-filter-utils'

interface ArtworkFilterPanelProps {
  localSearch: ArtworkFilterValue
  setLocalSearch: Dispatch<SetStateAction<ArtworkFilterValue>>
  advancedSearchOpen: boolean
  onAdvancedSearchOpenChange: (open: boolean) => void
  mediaTypeOptions: Option[]
  sourceOptions: Option[]
  onSearchTags: (query: string) => Promise<Option[]>
  onSearch: () => void
  onReset: () => void
  embedded?: boolean
  inlineLabels?: boolean
}

export function ArtworkFilterPanel({
  localSearch,
  setLocalSearch,
  advancedSearchOpen,
  onAdvancedSearchOpenChange,
  mediaTypeOptions,
  sourceOptions,
  onSearchTags,
  onSearch,
  onReset,
  embedded = false,
  inlineLabels = false
}: ArtworkFilterPanelProps) {
  const id = useId()
  const fieldId = (name: string) => `${id}-${name}`

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        onSearch()
      }}
      className={cn('flex w-full flex-col gap-4', !embedded && 'rounded-lg border bg-background p-4 shadow-sm')}
    >
      <div className={cn('grid grid-cols-1 items-end md:grid-cols-12', inlineLabels ? 'gap-x-4 gap-y-3' : 'gap-4')}>
        <div
          className={cn('col-span-12 md:col-span-3', inlineLabels ? 'flex items-center gap-2' : 'flex flex-col gap-1')}
        >
          <div className={cn('flex items-center', inlineLabels ? 'w-12 shrink-0' : 'h-6')}>
            <Label htmlFor={fieldId('id')} className="text-xs font-medium text-muted-foreground">
              内部 ID
            </Label>
          </div>
          <Input
            id={fieldId('id')}
            name="artworkId"
            autoComplete="off"
            inputMode="numeric"
            placeholder="例如 12345…"
            type="number"
            min={1}
            value={localSearch.id}
            onChange={(e) => setLocalSearch((prev) => ({ ...prev, id: e.target.value }))}
            className="h-9 w-full"
          />
        </div>

        <div
          className={cn('col-span-12 md:col-span-3', inlineLabels ? 'flex items-center gap-2' : 'flex flex-col gap-1')}
        >
          <div className={cn('flex items-center', inlineLabels ? 'w-12 shrink-0' : 'h-6')}>
            <Label htmlFor={fieldId('title')} className="text-xs font-medium text-muted-foreground">
              标题
            </Label>
          </div>
          <Input
            id={fieldId('title')}
            name="artworkTitle"
            autoComplete="off"
            placeholder="例如作品标题…"
            value={localSearch.title}
            onChange={(e) => setLocalSearch((prev) => ({ ...prev, title: e.target.value }))}
            className="h-9 w-full"
          />
        </div>

        <div
          className={cn('col-span-12 md:col-span-3', inlineLabels ? 'flex items-center gap-2' : 'flex flex-col gap-1')}
        >
          <div className={cn('flex items-center', inlineLabels ? 'w-12 shrink-0' : 'h-6')}>
            <Label htmlFor={fieldId('external-id')} className="text-xs font-medium text-muted-foreground">
              外部 ID
            </Label>
          </div>
          <Input
            id={fieldId('external-id')}
            name="externalId"
            autoComplete="off"
            spellCheck={false}
            placeholder="例如 12345678…"
            value={localSearch.externalId}
            onChange={(e) => setLocalSearch((prev) => ({ ...prev, externalId: e.target.value }))}
            className="h-9 w-full"
          />
        </div>

        <div
          className={cn('col-span-12 md:col-span-3', inlineLabels ? 'flex items-center gap-2' : 'flex flex-col gap-1')}
        >
          <div className={cn('flex items-center', inlineLabels ? 'w-12 shrink-0' : 'h-6')}>
            <Label htmlFor={fieldId('artist')} className="text-xs font-medium text-muted-foreground">
              作者
            </Label>
          </div>
          <Input
            id={fieldId('artist')}
            name="artistName"
            autoComplete="off"
            placeholder="例如作者名称或 Pixiv ID…"
            value={localSearch.artistName}
            onChange={(e) => setLocalSearch((prev) => ({ ...prev, artistName: e.target.value }))}
            className="h-9 w-full"
          />
        </div>

        <div className="col-span-12 flex flex-col md:flex-row gap-4 md:items-end justify-between">
          <div className={cn('flex w-full md:w-1/3', inlineLabels ? 'items-center gap-2' : 'flex-col gap-1')}>
            <div className={cn('flex items-center', inlineLabels ? 'w-12 shrink-0' : 'h-6')}>
              <Label className="text-xs font-medium text-muted-foreground">发布日期</Label>
            </div>
            <ProDatePicker
              mode="range"
              placeholder="选择日期范围"
              value={[
                localSearch.startDate ? new Date(localSearch.startDate) : undefined,
                localSearch.endDate ? new Date(localSearch.endDate) : undefined
              ]}
              onChange={(value = []) => {
                const [from, to] = value
                setLocalSearch((prev) => ({
                  ...prev,
                  startDate: from ? format(from, 'yyyy-MM-dd') : '',
                  endDate: to ? format(to, 'yyyy-MM-dd') : ''
                }))
              }}
              presets={ProDatePickerPresets.range}
              className="w-full"
            />
          </div>

          <div className="flex items-center gap-4 h-9 w-full md:w-auto justify-between md:justify-end">
            <div className="flex h-full shrink-0 items-center gap-2 rounded-md bg-muted px-3 py-2">
              <Checkbox
                id={fieldId('exact-match')}
                checked={localSearch.exactMatch}
                onCheckedChange={(checked) => setLocalSearch((prev) => ({ ...prev, exactMatch: !!checked }))}
              />
              <Label
                htmlFor={fieldId('exact-match')}
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 whitespace-nowrap cursor-pointer"
              >
                精确
              </Label>
            </div>

            <div className="flex gap-1">
              <Button type="submit" variant="default" size="sm" className="h-9 shrink-0 px-3">
                <Search aria-hidden="true" data-icon="inline-start" className="size-3" />
                搜索
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={onReset} className="h-9 shrink-0 px-3">
                <RotateCcw aria-hidden="true" data-icon="inline-start" className="size-3" />
                重置
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => onAdvancedSearchOpenChange(!advancedSearchOpen)}
                className={cn('h-9 shrink-0 px-2', advancedSearchOpen && 'bg-muted text-foreground')}
                aria-label={advancedSearchOpen ? '收起高级搜索' : '展开高级搜索'}
                aria-expanded={advancedSearchOpen}
                aria-controls={fieldId('advanced-search')}
              >
                {advancedSearchOpen ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {advancedSearchOpen && (
        <div
          id={fieldId('advanced-search')}
          className="grid grid-cols-1 gap-4 border-t pt-4 motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-2 motion-safe:duration-200 md:grid-cols-2 lg:grid-cols-12"
        >
          <div
            className={cn('col-span-1 lg:col-span-3', inlineLabels ? 'flex items-center gap-2' : 'flex flex-col gap-1')}
          >
            <div className={cn('flex items-center', inlineLabels ? 'w-12 shrink-0' : 'h-6')}>
              <Label className="text-xs font-medium text-muted-foreground">媒体数量</Label>
            </div>
            <div className={cn('flex items-center gap-2', inlineLabels && 'min-w-0 flex-1')}>
              <div className="relative flex-1">
                <Input
                  name="mediaCountMin"
                  aria-label="最少媒体数量"
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="最少…"
                  type="number"
                  min={0}
                  value={localSearch.mediaCountMin}
                  onChange={(e) => setLocalSearch((prev) => ({ ...prev, mediaCountMin: e.target.value }))}
                  className="h-9"
                />
                <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-muted-foreground">个</span>
              </div>
              <span className="text-muted-foreground">–</span>
              <div className="relative flex-1">
                <Input
                  name="mediaCountMax"
                  aria-label="最多媒体数量"
                  autoComplete="off"
                  inputMode="numeric"
                  placeholder="最多…"
                  type="number"
                  min={0}
                  value={localSearch.mediaCountMax}
                  onChange={(e) => setLocalSearch((prev) => ({ ...prev, mediaCountMax: e.target.value }))}
                  className="h-9"
                />
                <span className="pointer-events-none absolute right-3 top-2.5 text-xs text-muted-foreground">个</span>
              </div>
            </div>
          </div>

          <div
            className={cn('col-span-1 lg:col-span-3', inlineLabels ? 'flex items-center gap-2' : 'flex flex-col gap-1')}
          >
            <div className={cn('flex items-center', inlineLabels ? 'w-12 shrink-0' : 'h-6')}>
              <Label className="text-xs font-medium text-muted-foreground">媒体类型</Label>
            </div>
            <MultipleSelector
              value={localSearch.selectedMediaTypes}
              options={mediaTypeOptions}
              groupBy="category"
              onChange={(options) => setLocalSearch((prev) => ({ ...prev, selectedMediaTypes: options }))}
              placeholder="选择格式…"
              emptyIndicator={<p className="text-center text-sm text-gray-500 py-2">未找到相关格式</p>}
              className={cn('min-h-9 bg-background', inlineLabels && 'min-w-0 flex-1')}
              badgeClassName="bg-blue-50 text-blue-600 hover:bg-blue-100 border-transparent"
              selectFirstItem={false}
            />
          </div>

          <div
            className={cn('col-span-1 lg:col-span-2', inlineLabels ? 'flex items-center gap-2' : 'flex flex-col gap-1')}
          >
            <div className={cn('flex items-center', inlineLabels ? 'w-12 shrink-0' : 'h-6')}>
              <Label className="text-xs font-medium text-muted-foreground">视频音频</Label>
            </div>
            <Select
              value={localSearch.hasAudio}
              onValueChange={(value) => setLocalSearch((prev) => ({ ...prev, hasAudio: normalizeAudioFilter(value) }))}
            >
              <SelectTrigger
                className={cn('h-9 bg-background', inlineLabels && 'min-w-0 flex-1')}
                aria-label="视频音频筛选"
              >
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="all">全部</SelectItem>
                  <SelectItem value="yes">有音频</SelectItem>
                  <SelectItem value="no">无音频</SelectItem>
                  <SelectItem value="unknown">未探测</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>

          <div
            className={cn('col-span-1 lg:col-span-2', inlineLabels ? 'flex items-center gap-2' : 'flex flex-col gap-1')}
          >
            <div className={cn('flex items-center', inlineLabels ? 'w-12 shrink-0' : 'h-6')}>
              <Label className="text-xs font-medium text-muted-foreground">创建类型</Label>
            </div>
            <MultipleSelector
              value={localSearch.selectedSources}
              options={sourceOptions}
              onChange={(options) => setLocalSearch((prev) => ({ ...prev, selectedSources: options }))}
              placeholder="选择创建类型…"
              emptyIndicator={<p className="text-center text-sm text-gray-500 py-2">未找到创建类型</p>}
              className={cn('min-h-9 bg-background', inlineLabels && 'min-w-0 flex-1')}
              selectFirstItem={false}
            />
          </div>

          <div
            className={cn('col-span-1 lg:col-span-4', inlineLabels ? 'flex items-center gap-2' : 'flex flex-col gap-1')}
          >
            <div className={cn('flex items-center justify-between', inlineLabels ? 'shrink-0 gap-2' : 'h-6')}>
              <Label className="text-xs font-medium text-muted-foreground">标签筛选</Label>
              <div className="flex rounded-md bg-muted p-0.5" aria-label="标签筛选方式">
                <button
                  type="button"
                  aria-pressed={localSearch.tagMode === 'include'}
                  className={cn(
                    'rounded-sm px-2 py-0.5 text-[10px] outline-none transition-[color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/50',
                    localSearch.tagMode === 'include'
                      ? 'bg-background font-medium text-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setLocalSearch((prev) => ({ ...prev, tagMode: 'include' }))}
                >
                  包含
                </button>
                <button
                  type="button"
                  aria-pressed={localSearch.tagMode === 'exclude'}
                  className={cn(
                    'rounded-sm px-2 py-0.5 text-[10px] outline-none transition-[color,background-color,box-shadow] focus-visible:ring-2 focus-visible:ring-ring/50',
                    localSearch.tagMode === 'exclude'
                      ? 'bg-background font-medium text-destructive shadow-xs'
                      : 'text-muted-foreground hover:text-foreground'
                  )}
                  onClick={() => setLocalSearch((prev) => ({ ...prev, tagMode: 'exclude' }))}
                >
                  排除
                </button>
              </div>
            </div>
            <MultipleSelector
              value={localSearch.selectedTags}
              onChange={(options) => setLocalSearch((prev) => ({ ...prev, selectedTags: options }))}
              onSearch={onSearchTags}
              triggerSearchOnFocus
              placeholder={localSearch.tagMode === 'include' ? '搜索并选择标签…' : '搜索并排除标签…'}
              emptyIndicator={<p className="text-center text-sm text-gray-500 py-2">未找到相关标签</p>}
              className={cn('min-h-9 bg-background', inlineLabels && 'min-w-0 flex-1')}
              badgeClassName={
                localSearch.tagMode === 'include'
                  ? 'bg-primary/10 text-primary hover:bg-primary/20 border-transparent'
                  : 'bg-red-50 text-red-600 hover:bg-red-100 border-transparent'
              }
            />
          </div>
        </div>
      )}
    </form>
  )
}
