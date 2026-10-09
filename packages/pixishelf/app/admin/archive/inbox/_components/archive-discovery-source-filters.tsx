'use client'

import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { DEFAULT_SOURCE_FILTERS, type SourceListFilters } from './archive-discovery-filter-state'

export function ArchiveDiscoverySourceFilters({
  value,
  onChange,
  countsReady
}: {
  value: SourceListFilters
  onChange: (value: SourceListFilters) => void
  countsReady: boolean
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-3">
        <Input
          className="w-full sm:max-w-sm"
          type="search"
          aria-label="搜索来源"
          placeholder="搜索名称、UID 或关键词"
          value={value.search}
          onChange={(event) => onChange({ ...value, search: event.target.value })}
        />
        <Select
          value={value.status}
          onValueChange={(status: SourceListFilters['status']) => onChange({ ...value, status })}
        >
          <SelectTrigger aria-label="来源启停状态">
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
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <ToggleGroup
          type="single"
          value={value.kind}
          onValueChange={(kind: SourceListFilters['kind']) => kind && onChange({ ...value, kind })}
          variant="outline"
          aria-label="来源类型"
        >
          <ToggleGroupItem value="ALL">全部来源</ToggleGroupItem>
          <ToggleGroupItem value="UPLOADER">上传者</ToggleGroupItem>
          <ToggleGroupItem value="TITLE_QUERY">标题关键词</ToggleGroupItem>
        </ToggleGroup>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.actionable}
            disabled={!countsReady}
            onCheckedChange={(checked) => onChange({ ...value, actionable: checked === true })}
          />
          有待处理
        </label>
        <label className="flex items-center gap-2 text-sm">
          <Checkbox
            checked={value.attention}
            disabled={!countsReady}
            onCheckedChange={(checked) => onChange({ ...value, attention: checked === true })}
          />
          有异常
        </label>
        {JSON.stringify(value) !== JSON.stringify(DEFAULT_SOURCE_FILTERS) ? (
          <Button size="sm" variant="ghost" onClick={() => onChange(DEFAULT_SOURCE_FILTERS)}>
            重置来源筛选
          </Button>
        ) : null}
      </div>
    </div>
  )
}
