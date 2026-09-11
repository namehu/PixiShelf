'use client'

import { AdminSectionHeader } from '@/app/admin/_components/admin-workbench'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import type { ArchiveUploaderResultView } from '@/store/admin/use-admin-preferences-store'
import { ArchiveIntakeOptionsDialog, type ArchiveIntakeOptionsValue } from './archive-intake-options'
import { ArchiveUploaderResultViewToggle } from './archive-uploader-result-visuals'

export type ArchiveDiscoveryCatalogView = 'ACTIONABLE' | 'PROCESSING' | 'ARCHIVED' | 'ATTENTION' | 'ALL'

const RESULT_FEEDS: Array<{ value: ArchiveDiscoveryCatalogView; label: string }> = [
  { value: 'ACTIONABLE', label: '待处理' },
  { value: 'PROCESSING', label: '处理中' },
  { value: 'ARCHIVED', label: '已归档' },
  { value: 'ATTENTION', label: '异常' },
  { value: 'ALL', label: '全部' }
]

export function ArchiveDiscoveryResultsToolbar({
  view,
  counts,
  description,
  resultView,
  onViewChange,
  onResultViewChange,
  intakeOptions,
  onIntakeOptionsChange,
  disabled
}: {
  view: ArchiveDiscoveryCatalogView
  counts: Record<ArchiveDiscoveryCatalogView, number>
  description: string
  resultView: ArchiveUploaderResultView
  onViewChange: (view: ArchiveDiscoveryCatalogView) => void
  onResultViewChange: (view: ArchiveUploaderResultView) => void
  intakeOptions: ArchiveIntakeOptionsValue
  onIntakeOptionsChange: (value: ArchiveIntakeOptionsValue) => void
  disabled: boolean
}) {
  const supportsIntake = view === 'ACTIONABLE' || view === 'ATTENTION' || view === 'ALL'

  return (
    <AdminSectionHeader
      className="items-stretch sm:flex-col sm:items-stretch [&>div:last-child]:w-full [&>div:last-child]:min-w-0 [&>div:last-child]:flex-nowrap [&>div:last-child]:shrink"
      title={resultFeedLabel(view)}
      description={description}
      actions={
        <>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(value) => value && onViewChange(value as ArchiveDiscoveryCatalogView)}
            variant="outline"
            size="sm"
            aria-label="结果范围"
            className="min-w-0 flex-1 justify-start overflow-x-auto"
          >
            {RESULT_FEEDS.map((feed) => (
              <ToggleGroupItem key={feed.value} value={feed.value} aria-label={`查看${feed.label}`}>
                {feed.label} {counts[feed.value]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <ArchiveUploaderResultViewToggle value={resultView} onChange={onResultViewChange} />
          {supportsIntake ? (
            <ArchiveIntakeOptionsDialog value={intakeOptions} onChange={onIntakeOptionsChange} disabled={disabled} />
          ) : null}
        </>
      }
    />
  )
}

export function resultFeedLabel(feed: ArchiveDiscoveryCatalogView) {
  return RESULT_FEEDS.find(({ value }) => value === feed)?.label ?? '发现目录'
}
