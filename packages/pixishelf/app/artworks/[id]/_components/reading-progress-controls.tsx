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
      <div className="flex h-20 items-center gap-3 text-sm" role="status">
        <span>作品媒体已更新，请重新打开阅读。</span>
        <Button size="sm" variant="outline" onClick={reading.reopen}>重新打开</Button>
      </div>
    )
  }
  const summary = reading.summary
  if (!summary || empty) { return (
    <div className="flex h-20 items-center gap-3 text-xs text-muted-foreground" aria-busy={reading.isLoading}>
      {!empty && (reading.error ? <>
        <span role="status">阅读状态加载失败</span>
        <Button size="sm" variant="outline" onClick={() => void reading.retry?.()}>重试</Button>
      </> : <span role="status">正在加载阅读状态…</span>)}
    </div>
  ) }
  const remaining = Math.max(0, summary.totalCount - summary.seenCount)
  const completed = summary.status === 'COMPLETED'
  return (
    <div className="flex h-20 flex-col justify-center gap-2">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 tabular-nums" role="status">
            {completed ? <><CheckIcon className="size-3.5" aria-hidden="true" />已读完 · {summary.totalCount} 张</> :
              <>已读 {summary.seenCount} / {summary.totalCount}<span>· 剩余 {remaining}</span></>}
          </span>
          {summary.viewCount > 0 && <span>阅读 {summary.viewCount} 次</span>}
        </div>
      </div>
      <p role={reading.markError || reading.error ? 'alert' : undefined} className="h-5 text-xs text-destructive">
        {reading.markError || (reading.error ? '阅读进度尚未保存，请检查连接。' : '\u00a0')}
      </p>
    </div>
  )
}
