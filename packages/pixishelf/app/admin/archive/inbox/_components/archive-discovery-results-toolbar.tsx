'use client'

import { useId } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'
import { ArchiveUploaderResultViewToggle } from './archive-uploader-result-visuals'

export type ArchiveDiscoveryCatalogView = 'ACTIONABLE' | 'PROCESSING' | 'ARCHIVED' | 'DELETED' | 'ATTENTION' | 'ALL'

const RESULT_FEEDS: Array<{ value: ArchiveDiscoveryCatalogView; label: string }> = [
  { value: 'ACTIONABLE', label: '待处理' },
  { value: 'PROCESSING', label: '处理中' },
  { value: 'ARCHIVED', label: '已归档' },
  { value: 'DELETED', label: '已删除' },
  { value: 'ATTENTION', label: '异常' },
  { value: 'ALL', label: '全部' }
]

export function ArchiveDiscoveryResultsToolbar({
  view,
  counts,
  resultView,
  onViewChange,
  onResultViewChange
}: {
  view: ArchiveDiscoveryCatalogView
  counts: Record<ArchiveDiscoveryCatalogView, number | null>
  resultView: ArchiveUploaderResultView
  onViewChange: (view: ArchiveDiscoveryCatalogView) => void
  onResultViewChange: (view: ArchiveUploaderResultView) => void
}) {
  const rangeLabelId = useId()

  return (
    <div className="flex min-w-0 items-center gap-2">
      <span id={rangeLabelId} className="sr-only shrink-0 text-sm text-muted-foreground sm:not-sr-only">
        结果范围
      </span>
      <div className="min-w-0 flex-1 overflow-x-auto pb-1">
        <ToggleGroup
          type="single"
          value={view}
          onValueChange={(value) => value && onViewChange(value as ArchiveDiscoveryCatalogView)}
          variant="outline"
          size="sm"
          aria-labelledby={rangeLabelId}
          className="justify-start"
        >
          {RESULT_FEEDS.map((feed) => (
            <ToggleGroupItem
              key={feed.value}
              value={feed.value}
              aria-label={`查看${feed.label}`}
              className="min-h-11 gap-1.5 sm:min-h-8"
            >
              {feed.label} <span className="tabular-nums">{counts[feed.value] ?? '…'}</span>
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="shrink-0 self-start [&_[data-slot=button]]:size-11 sm:[&_[data-slot=button]]:size-8">
        <ArchiveUploaderResultViewToggle value={resultView} onChange={onResultViewChange} />
      </div>
    </div>
  )
}

export function resultFeedLabel(feed: ArchiveDiscoveryCatalogView) {
  return RESULT_FEEDS.find(({ value }) => value === feed)?.label ?? '发现目录'
}
