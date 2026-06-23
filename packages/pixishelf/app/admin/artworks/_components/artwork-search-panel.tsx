'use client'

import { Dispatch, SetStateAction } from 'react'
import { Search, RotateCcw, ChevronDown, ChevronUp } from 'lucide-react'
import { format } from 'date-fns'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import MultipleSelector, { Option } from '@/components/shared/multiple-selector'
import { ProDatePicker, ProDatePickerPresets } from '@/components/shared/pro-date-picker'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { LocalArtworkSearchState } from './artwork-management-types'
import { normalizeAudioFilter } from './artwork-management-utils'

interface ArtworkSearchPanelProps {
  localSearch: LocalArtworkSearchState
  setLocalSearch: Dispatch<SetStateAction<LocalArtworkSearchState>>
  advancedSearchOpen: boolean
  onAdvancedSearchOpenChange: (open: boolean) => void
  mediaTypeOptions: Option[]
  sourceOptions: Option[]
  onSearchTags: (query: string) => Promise<Option[]>
  onSearch: () => void
  onReset: () => void
}

export function ArtworkSearchPanel({
  localSearch,
  setLocalSearch,
  advancedSearchOpen,
  onAdvancedSearchOpenChange,
  mediaTypeOptions,
  sourceOptions,
  onSearchTags,
  onSearch,
  onReset
}: ArtworkSearchPanelProps) {
  return (
    <div className="flex flex-col gap-4 w-full bg-white p-4 rounded-lg border border-neutral-200 shadow-sm">
      <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-end">
        <div className="col-span-12 md:col-span-3 space-y-1">
          <div className="h-6 flex items-center">
            <Label className="text-xs font-medium text-neutral-500">内部ID</Label>
          </div>
          <Input
            placeholder="作品内部ID..."
            type="number"
            min={1}
            value={localSearch.id}
            onChange={(e) => setLocalSearch((prev) => ({ ...prev, id: e.target.value }))}
            className="h-9 w-full"
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
        </div>

        <div className="col-span-12 md:col-span-3 space-y-1">
          <div className="h-6 flex items-center">
            <Label className="text-xs font-medium text-neutral-500">标题</Label>
          </div>
          <Input
            placeholder="搜索作品标题..."
            value={localSearch.title}
            onChange={(e) => setLocalSearch((prev) => ({ ...prev, title: e.target.value }))}
            className="h-9 w-full"
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
        </div>

        <div className="col-span-6 md:col-span-3 space-y-1">
          <div className="h-6 flex items-center">
            <Label className="text-xs font-medium text-neutral-500">外部ID</Label>
          </div>
          <Input
            placeholder="外部ID..."
            value={localSearch.externalId}
            onChange={(e) => setLocalSearch((prev) => ({ ...prev, externalId: e.target.value }))}
            className="h-9 w-full"
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
        </div>

        <div className="col-span-6 md:col-span-3 space-y-1">
          <div className="h-6 flex items-center">
            <Label className="text-xs font-medium text-neutral-500">作者</Label>
          </div>
          <Input
            placeholder="作者名称 / Pixiv ID..."
            value={localSearch.artistName}
            onChange={(e) => setLocalSearch((prev) => ({ ...prev, artistName: e.target.value }))}
            className="h-9 w-full"
            onKeyDown={(e) => e.key === 'Enter' && onSearch()}
          />
        </div>

        <div className="col-span-12 flex flex-col md:flex-row gap-4 md:items-end justify-between">
          <div className="w-full md:w-1/3 space-y-1">
            <div className="h-6 flex items-center">
              <Label className="text-xs font-medium text-neutral-500">发布日期</Label>
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
            <div className="flex items-center space-x-2 bg-neutral-100 px-3 py-2 rounded-md h-full shrink-0">
              <Checkbox
                id="exactMatch"
                checked={localSearch.exactMatch}
                onCheckedChange={(checked) => setLocalSearch((prev) => ({ ...prev, exactMatch: !!checked }))}
              />
              <label
                htmlFor="exactMatch"
                className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 whitespace-nowrap cursor-pointer"
              >
                精确
              </label>
            </div>

            <div className="flex gap-1">
              <Button variant="default" size="sm" onClick={onSearch} className="h-9 px-3 shrink-0">
                <Search className="w-3 h-3 mr-1" />
                搜索
              </Button>
              <Button variant="outline" size="sm" onClick={onReset} className="h-9 px-3 shrink-0">
                <RotateCcw className="w-3 h-3 mr-1" />
                重置
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onAdvancedSearchOpenChange(!advancedSearchOpen)}
                className={cn('h-9 px-2 shrink-0', advancedSearchOpen && 'bg-neutral-100 text-neutral-900')}
                title={advancedSearchOpen ? '收起高级搜索' : '展开高级搜索'}
              >
                {advancedSearchOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </Button>
            </div>
          </div>
        </div>
      </div>

      {advancedSearchOpen && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-12 gap-4 pt-4 border-t border-neutral-100 animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="col-span-1 lg:col-span-3 space-y-1">
            <div className="h-6 flex items-center">
              <Label className="text-xs font-medium text-neutral-500">媒体数量</Label>
            </div>
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Input
                  placeholder="最小"
                  type="number"
                  min={0}
                  value={localSearch.mediaCountMin}
                  onChange={(e) => setLocalSearch((prev) => ({ ...prev, mediaCountMin: e.target.value }))}
                  className="h-9"
                />
                <span className="absolute right-3 top-2.5 text-xs text-neutral-400">个</span>
              </div>
              <span className="text-neutral-400">-</span>
              <div className="relative flex-1">
                <Input
                  placeholder="最大"
                  type="number"
                  min={0}
                  value={localSearch.mediaCountMax}
                  onChange={(e) => setLocalSearch((prev) => ({ ...prev, mediaCountMax: e.target.value }))}
                  className="h-9"
                />
                <span className="absolute right-3 top-2.5 text-xs text-neutral-400">个</span>
              </div>
            </div>
          </div>

          <div className="col-span-1 lg:col-span-3 space-y-1">
            <div className="h-6 flex items-center">
              <Label className="text-xs font-medium text-neutral-500">媒体类型</Label>
            </div>
            <MultipleSelector
              value={localSearch.selectedMediaTypes}
              options={mediaTypeOptions}
              groupBy="category"
              onChange={(options) => setLocalSearch((prev) => ({ ...prev, selectedMediaTypes: options }))}
              placeholder="选择格式..."
              emptyIndicator={<p className="text-center text-sm text-gray-500 py-2">未找到相关格式</p>}
              className="bg-white min-h-[36px]"
              badgeClassName="bg-blue-50 text-blue-600 hover:bg-blue-100 border-transparent"
              selectFirstItem={false}
            />
          </div>

          <div className="col-span-1 lg:col-span-2 space-y-1">
            <div className="h-6 flex items-center">
              <Label className="text-xs font-medium text-neutral-500">视频音频</Label>
            </div>
            <Select
              value={localSearch.hasAudio}
              onValueChange={(value) => setLocalSearch((prev) => ({ ...prev, hasAudio: normalizeAudioFilter(value) }))}
            >
              <SelectTrigger className="h-9 bg-white">
                <SelectValue placeholder="全部" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部</SelectItem>
                <SelectItem value="yes">有音频</SelectItem>
                <SelectItem value="no">无音频</SelectItem>
                <SelectItem value="unknown">未探测</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="col-span-1 lg:col-span-2 space-y-1">
            <div className="h-6 flex items-center">
              <Label className="text-xs font-medium text-neutral-500">创建类型</Label>
            </div>
            <MultipleSelector
              value={localSearch.selectedSources}
              options={sourceOptions}
              onChange={(options) => setLocalSearch((prev) => ({ ...prev, selectedSources: options }))}
              placeholder="选择创建类型..."
              emptyIndicator={<p className="text-center text-sm text-gray-500 py-2">未找到创建类型</p>}
              className="bg-white min-h-[36px]"
              selectFirstItem={false}
            />
          </div>

          <div className="col-span-1 lg:col-span-4 space-y-1">
            <div className="h-6 flex items-center justify-between">
              <Label className="text-xs font-medium text-neutral-500">标签筛选</Label>
              <div className="flex bg-neutral-100 rounded-md p-0.5">
                <button
                  type="button"
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-sm transition-all',
                    localSearch.tagMode === 'include'
                      ? 'bg-white shadow-sm text-neutral-900 font-medium'
                      : 'text-neutral-500 hover:text-neutral-700'
                  )}
                  onClick={() => setLocalSearch((prev) => ({ ...prev, tagMode: 'include' }))}
                >
                  包含
                </button>
                <button
                  type="button"
                  className={cn(
                    'text-[10px] px-2 py-0.5 rounded-sm transition-all',
                    localSearch.tagMode === 'exclude'
                      ? 'bg-white shadow-sm text-red-600 font-medium'
                      : 'text-neutral-500 hover:text-neutral-700'
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
              placeholder={localSearch.tagMode === 'include' ? '搜索并选择标签...' : '搜索并排除标签...'}
              emptyIndicator={<p className="text-center text-sm text-gray-500 py-2">未找到相关标签</p>}
              className="bg-white min-h-[36px]"
              badgeClassName={
                localSearch.tagMode === 'include'
                  ? 'bg-primary/10 text-primary hover:bg-primary/20 border-transparent'
                  : 'bg-red-50 text-red-600 hover:bg-red-100 border-transparent'
              }
            />
          </div>
        </div>
      )}
    </div>
  )
}
