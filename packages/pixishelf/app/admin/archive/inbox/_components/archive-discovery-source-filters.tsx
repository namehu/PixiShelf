'use client'

import { useId, useState, type ReactNode } from 'react'
import { SlidersHorizontalIcon } from 'lucide-react'
import { useMediaQuery } from '@/hooks/use-media-query'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DEFAULT_SOURCE_FILTERS,
  DEFAULT_SOURCE_SORT,
  SOURCE_SORT_LABELS,
  SOURCE_SORT_VALUES,
  type SourceListFilters,
  type SourceListSort
} from './archive-discovery-filter-state'

export function ArchiveDiscoverySourceFilters({
  value,
  onChange,
  sort,
  onSortChange,
  countsReady,
  actions,
  summary
}: {
  value: SourceListFilters
  onChange: (value: SourceListFilters) => void
  sort: SourceListSort
  onSortChange: (sort: SourceListSort) => void
  actions?: ReactNode
  summary?: ReactNode
  countsReady: boolean
}) {
  const desktop = useMediaQuery('(min-width: 640px)')
  const [expanded, setExpanded] = useState(false)
  const filtersId = useId()
  const activeCount =
    Number(value.status !== DEFAULT_SOURCE_FILTERS.status) +
    Number(value.kind !== DEFAULT_SOURCE_FILTERS.kind) +
    Number(value.actionable) +
    Number(value.attention) +
    Number(sort !== DEFAULT_SOURCE_SORT)

  return (
    <div className="flex flex-col gap-2 sm:gap-3">
      {(actions || summary) && (
        <div className="flex items-center justify-between gap-2">
          {summary}
          {actions && <div className="flex shrink-0 items-center gap-1">{actions}</div>}
        </div>
      )}
      <div className="flex flex-col gap-3 sm:grid sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:rounded-lg sm:bg-muted/40 sm:p-3">
        <div className="flex min-w-0 items-center gap-2">
          <Input
            className="h-11 min-w-0 flex-1 sm:h-9"
            type="search"
            aria-label="搜索来源"
            placeholder="搜索名称、UID 或关键词"
            value={value.search}
            onChange={(event) => onChange({ ...value, search: event.target.value })}
          />
          {!desktop && (
            <Button
              variant={activeCount ? 'secondary' : 'outline'}
              className="h-11"
              aria-label="来源筛选与排序"
              aria-expanded={expanded}
              aria-controls={filtersId}
              onClick={() => setExpanded(!expanded)}
            >
              <SlidersHorizontalIcon data-icon="inline-start" aria-hidden="true" />
              筛选{activeCount > 0 ? ` · ${activeCount}` : ''}
            </Button>
          )}
        </div>
        <div id={filtersId} hidden={!desktop && !expanded} className="sm:contents">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={value.status}
              onValueChange={(status: SourceListFilters['status']) => onChange({ ...value, status })}
            >
              <SelectTrigger aria-label="来源启停状态" className="min-h-11 shrink-0 sm:min-h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="ACTIVE">启用来源</SelectItem>
                  <SelectItem value="ALL">全部状态</SelectItem>
                  <SelectItem value="ARCHIVED">已停用</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <Select value={sort} onValueChange={onSortChange}>
              <SelectTrigger aria-label="来源排序" className="min-h-11 min-w-0 flex-1 sm:min-h-9 sm:flex-none">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {SOURCE_SORT_VALUES.map((option) => (
                    <SelectItem key={option} value={option} disabled={option.startsWith('actionable-') && !countsReady}>
                      {SOURCE_SORT_LABELS[option]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 sm:col-span-2 sm:mt-0">
            <ToggleGroup
              type="single"
              value={value.kind}
              onValueChange={(kind: SourceListFilters['kind']) => kind && onChange({ ...value, kind })}
              variant="outline"
              aria-label="来源类型"
            >
              <ToggleGroupItem value="ALL" className="h-11 sm:h-9">
                全部来源
              </ToggleGroupItem>
              <ToggleGroupItem value="UPLOADER" className="h-11 sm:h-9">
                上传者
              </ToggleGroupItem>
              <ToggleGroupItem value="TITLE_QUERY" className="h-11 sm:h-9">
                标题关键词
              </ToggleGroupItem>
            </ToggleGroup>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <Checkbox
                checked={value.actionable}
                disabled={!countsReady}
                onCheckedChange={(checked) => onChange({ ...value, actionable: checked === true })}
              />
              有待处理
            </label>
            <label className="flex min-h-11 items-center gap-2 text-sm sm:min-h-9">
              <Checkbox
                checked={value.attention}
                disabled={!countsReady}
                onCheckedChange={(checked) => onChange({ ...value, attention: checked === true })}
              />
              有异常
            </label>
            {JSON.stringify(value) !== JSON.stringify(DEFAULT_SOURCE_FILTERS) || sort !== DEFAULT_SOURCE_SORT ? (
              <Button
                className="min-h-11 sm:min-h-9"
                size="sm"
                variant="ghost"
                onClick={() => {
                  onChange(DEFAULT_SOURCE_FILTERS)
                  onSortChange(DEFAULT_SOURCE_SORT)
                }}
              >
                重置来源筛选
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
