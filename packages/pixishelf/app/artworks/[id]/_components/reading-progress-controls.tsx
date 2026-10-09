'use client'

import { CheckIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'

export function ReadingProgressControls({ reading, empty = false }: {
  reading: ArtworkReadingHandle
  empty?: boolean
}) {
  if (reading.invalidated) {
    return (
      <div className="flex flex-wrap items-center gap-3 py-3 text-sm" role="status">
        <span>作品媒体已更新，请重新打开阅读。</span>
        <Button size="sm" variant="outline" onClick={reading.reopen}>重新打开</Button>
      </div>
    )
  }
  const summary = reading.summary
  if (!summary || empty) return null
  const remaining = Math.max(0, summary.totalCount - summary.seenCount)
  const completed = summary.status === 'COMPLETED'
  return (
    <div className="flex flex-col gap-2 py-4">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 tabular-nums" role="status">
            {completed ? <><CheckIcon className="size-3.5" aria-hidden="true" />已读完 · {summary.totalCount} 张</> :
              <>已读 {summary.seenCount} / {summary.totalCount}<span>· 剩余 {remaining}</span></>}
          </span>
          {summary.viewCount > 0 && <span>阅读 {summary.viewCount} 次</span>}
        </div>
      </div>
      {reading.markError && <p role="alert" className="text-sm text-destructive">{reading.markError}</p>}
    </div>
  )
}
