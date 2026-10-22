'use client'

import { useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { ArchiveTitleRules } from '@pixishelf/job-contracts'
import { useTRPC } from '@/lib/trpc'
import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ArchiveTitleRuleSheet } from './archive-title-rule-sheet'
import { ArchiveTitleFilteredResults } from './archive-title-filtered-results'
import { ArchiveTitleCreatorCleanup } from './archive-title-creator-cleanup'
import { useTitleReview } from './use-title-review'
import { ListFilterIcon, RotateCcwIcon } from 'lucide-react'

type PanelProps = {
  sourceId: string
  rules: ArchiveTitleRules | null
  rulesVersion: number
  activeScan: boolean
  onClearSelection: () => void
  children: ReactNode
}

export function ArchiveTitleSourcePanel(props: PanelProps) {
  return props.rules ? <TitlePanel {...props} rules={props.rules} /> : props.children
}

function TitlePanel({
  sourceId,
  rules,
  rulesVersion,
  activeScan,
  onClearSelection,
  children
}: PanelProps & { rules: ArchiveTitleRules }) {
  const trpc = useTRPC()
  const [view, setView] = useState('accepted')
  const [edit, setEdit] = useState(false)
  const [cleanup, setCleanup] = useState(false)
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
            <TabsTrigger className="min-h-11" value="accepted">
              已接纳 {counts.data?.accepted ?? '—'}
            </TabsTrigger>
            <TabsTrigger className="min-h-11" value="filtered">
              已过滤 {counts.data?.filtered ?? '—'}
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex flex-wrap gap-2">
          <Button className="h-11 sm:h-9" variant="outline" onClick={() => setEdit(true)}>
            编辑接纳规则
          </Button>
          <Button className="h-11 sm:h-9" variant="ghost" onClick={() => setCleanup(true)}>
            清理历史艺术家标记
          </Button>
        </div>
      </div>
      {counts.isError ? (
        <Button variant="outline" onClick={() => void counts.refetch()}>
          复核统计加载失败，重试
        </Button>
      ) : null}
      {view === 'accepted' ? children : <ArchiveTitleFilteredResults sourceId={sourceId} rulesVersion={rulesVersion} />}
      {edit ? (
        <ArchiveTitleRuleSheet
          sourceId={sourceId}
          initialRules={rules}
          rulesVersion={rulesVersion}
          activeScan={activeScan}
          onClose={() => setEdit(false)}
        />
      ) : null}
      {cleanup ? <ArchiveTitleCreatorCleanup sourceId={sourceId} onClose={() => setCleanup(false)} /> : null}
    </div>
  )
}

export function ArchiveTitleReviewBulkActions({
  sourceId,
  rulesVersion,
  selectedIds,
  onSaved,
  disabled
}: {
  sourceId: string
  rulesVersion: number
  selectedIds: string[]
  onSaved: () => void
  disabled: boolean
}) {
  const review = useTitleReview(sourceId, rulesVersion, onSaved)
  return (
    <>
      <Button
        variant="outline"
        className="size-11 p-0 sm:h-9 sm:w-auto sm:px-3"
        aria-label="从本来源排除所选"
        title="从本来源排除所选"
        disabled={disabled || review.pending}
        onClick={() => review.review(selectedIds, 'EXCLUDE')}
      >
        <ListFilterIcon aria-hidden="true" />
        <span className="hidden sm:inline">从本来源排除</span>
      </Button>
      <Button
        variant="ghost"
        className="size-11 p-0 sm:h-9 sm:w-auto sm:px-3"
        aria-label="恢复所选遵循规则"
        title="恢复所选遵循规则"
        disabled={disabled || review.pending}
        onClick={() => review.review(selectedIds, 'AUTO')}
      >
        <RotateCcwIcon aria-hidden="true" />
        <span className="hidden sm:inline">遵循规则</span>
      </Button>
    </>
  )
}
