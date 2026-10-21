'use client'

import Link from 'next/link'
import { Layers2Icon, RotateCwIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { useArtworkSummary } from './artwork-summary-context'
import type { SummaryDecoration } from './artwork-summary-projection'

export function ArtworkSummaryControls({ compact = false }: { compact?: boolean }) {
  const summary = useArtworkSummary()
  if (!summary) return null
  const { query, ready, mode, start, generate } = summary
  if (ready) {return <div className="flex items-center gap-1">
    <ToggleGroup type="single" disabled={summary.navigating} value={mode} onValueChange={(value) => {
      if (value === 'complete' || value === 'summary') summary.changeMode(value)
    }} aria-label="浏览方式" className="bg-muted/70 p-0.5">
      <ToggleGroupItem value="complete" className="min-h-11 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm">完整</ToggleGroupItem>
      <ToggleGroupItem value="summary" className="min-h-11 gap-1.5 text-xs data-[state=on]:bg-background data-[state=on]:shadow-sm">
        <Layers2Icon className="size-3.5" aria-hidden="true" />摘要
        {!compact && <span className="font-utility text-muted-foreground">{query.data?.groups.length}</span>}
      </ToggleGroupItem>
    </ToggleGroup>
    {!compact && <Button variant="ghost" size="icon" className="size-11 text-muted-foreground" aria-label="重新生成摘要" disabled={generate.isPending} onClick={start}><RotateCwIcon className="size-3.5" /></Button>}
  </div>}
  if (query.isPending) return <span className="text-xs text-muted-foreground" role="status">正在读取摘要…</span>
  if (query.error) return <Button variant="ghost" className="min-h-11 text-xs" onClick={() => void query.refetch()}>重试读取摘要</Button>
  if (query.data?.state === 'BUILDING') {return <Link className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground hover:text-foreground" href="/admin/tasks">
    <span role="status">{query.data.job?.status === 'PAUSED' ? '摘要已暂停' : `正在整理 · ${query.data.job?.processed ?? 0}/${query.data.job?.total || '…'}`}</span>
    {!compact && <span className="underline underline-offset-4">管理任务</span>}
  </Link>}
  return <Button variant="ghost" className="min-h-11 gap-1.5 text-xs" disabled={generate.isPending} onClick={start}>
    <Layers2Icon className="size-3.5" aria-hidden="true" />{generate.isPending ? '正在提交…' : query.data?.state === 'STALE' ? '重新生成摘要' : '生成摘要'}
  </Button>
}

export function SummaryGroupCaption({ decoration, footer = false }: { decoration: SummaryDecoration; footer?: boolean }) {
  const summary = useArtworkSummary()
  if (!summary || decoration.visibleCount < 2) return null
  const { group, expanded, representativeId, visibleCount } = decoration
  return <div className={`flex min-h-16 items-center justify-between gap-3 px-4 sm:px-8 ${footer ? 'border-b border-border/70 pb-3' : 'pt-2 pb-4'}`}>
    <span className="font-utility text-xs tabular-nums text-muted-foreground">
      {String(group.startIndex + 1).padStart(3, '0')}—{String(group.endIndex + 1).padStart(3, '0')}
      <span className="ml-2 font-sans">· 共 {visibleCount} 张</span>
    </span>
    <Button variant="ghost" className="min-h-11 shrink-0 px-2 text-xs text-primary" aria-expanded={expanded} disabled={summary.navigating} data-summary-toggle={group.id}
      onClick={() => summary.toggleGroup(group.id, representativeId)}>
      {expanded ? '收起这组' : `展开其余 ${visibleCount - 1} 张`}
    </Button>
  </div>
}
