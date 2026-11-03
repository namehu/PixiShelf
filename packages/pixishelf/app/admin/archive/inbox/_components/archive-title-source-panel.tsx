'use client'

import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ArchiveTitleRules } from '@pixishelf/job-contracts'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArchiveTitleFilteredResults } from './archive-title-filtered-results'
import { useTitleReview } from './use-title-review'
import { CheckIcon, ListFilterIcon, RotateCcwIcon } from 'lucide-react'
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu'

type PanelProps = {
  sourceId: string
  rules: ArchiveTitleRules | null
  rulesVersion: number
  activeScan: boolean
  onClearSelection: () => void
  actions?: ReactNode
  children: (review?: ReturnType<typeof useTitleReview>) => ReactNode
}

export function ArchiveTitleReviewMenuItems({
  review,
  selectedIds,
  disabled
}: {
  review: ReturnType<typeof useTitleReview>
  selectedIds: string[]
  disabled: boolean
}) {
  return (
    <DropdownMenuGroup>
      <DropdownMenuItem disabled={disabled || review.pending} onSelect={() => review.review(selectedIds, 'EXCLUDE')}>
        <ListFilterIcon aria-hidden="true" />
        从本来源排除（{selectedIds.length}）
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disabled || review.pending} onSelect={() => review.review(selectedIds, 'INCLUDE')}>
        <CheckIcon aria-hidden="true" />
        记住为手动接纳（{selectedIds.length}）
      </DropdownMenuItem>
      <DropdownMenuItem disabled={disabled || review.pending} onSelect={() => review.review(selectedIds, 'AUTO')}>
        <RotateCcwIcon aria-hidden="true" />
        恢复遵循规则（{selectedIds.length}）
      </DropdownMenuItem>
    </DropdownMenuGroup>
  )
}

export function ArchiveTitleSourcePanel(props: PanelProps) {
  return props.rules ? (
    <TitlePanel {...props} rules={props.rules} />
  ) : (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex flex-wrap justify-end gap-1">{props.actions}</div>
      {props.children()}
    </div>
  )
}

function TitlePanel({
  sourceId,
  rules,
  rulesVersion,
  activeScan,
  onClearSelection,
  actions,
  children
}: PanelProps & { rules: ArchiveTitleRules }) {
  const trpc = useTRPC()
  const [view, setView] = useState('accepted')
  const review = useTitleReview(sourceId, rulesVersion, onClearSelection)
  const counts = useQuery(
    trpc.archiveSearch.reviewCounts.queryOptions(
      { sourceId },
      { enabled: Boolean(rules), refetchInterval: activeScan ? 3000 : false }
    )
  )
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={view}
          onValueChange={(value) => {
            setView(value)
            onClearSelection()
          }}
        >
          <TabsList>
            <TabsTrigger className="min-h-11" value="accepted" disabled={review.pending}>
              已接纳 {counts.data?.accepted ?? '—'}
            </TabsTrigger>
            <TabsTrigger className="min-h-11" value="filtered" disabled={review.pending}>
              已过滤 {counts.data?.filtered ?? '—'}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-1">{actions}</div>
      </div>
      {counts.isError ? (
        <Button variant="outline" onClick={() => void counts.refetch()}>
          复核统计加载失败，重试
        </Button>
      ) : null}
      {view === 'accepted' ? (
        children(review)
      ) : (
        <ArchiveTitleFilteredResults sourceId={sourceId} rulesVersion={rulesVersion} counts={counts.data} />
      )}
    </div>
  )
}
