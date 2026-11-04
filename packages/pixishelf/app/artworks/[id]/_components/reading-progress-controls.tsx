'use client'

import { CheckCheckIcon, CheckIcon, LoaderCircleIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'

export function ReadingProgressControls({ reading, empty = false, resumeError, resumeLoading = false, showMarkAll = false }: {
  reading: ArtworkReadingHandle
  empty?: boolean
  resumeError?: unknown
  resumeLoading?: boolean
  showMarkAll?: boolean
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
  if (!summary || resumeError) { return (
    <div className="flex h-20 items-center gap-3 text-xs text-muted-foreground" aria-busy={reading.isLoading || resumeLoading}>
      {(!empty || Boolean(resumeError)) && (resumeError || reading.error ? <>
        <span role="status">{resumeError ? '继续阅读加载失败' : '阅读状态加载失败'}</span>
        <Button size="sm" variant="outline" disabled={resumeLoading} onClick={() => void reading.retry?.()}>
          {resumeLoading ? '正在重试…' : '重试'}
        </Button>
      </> : <span role="status">正在加载阅读状态…</span>)}
    </div>
  ) }
  const remaining = Math.max(0, summary.totalCount - summary.progressCount)
  const completed = summary.completed
  const markDisabled = !reading.context || !reading.ownerUserId || reading.isLoading || resumeLoading || reading.marking || completed || summary.totalCount === 0
  const errorMessage = reading.markError || (reading.error ? '阅读进度尚未保存，请检查连接。' : null)
  return (
    <div className={showMarkAll ? 'flex flex-col gap-1' : 'flex h-20 flex-col justify-center gap-2'}>
      <div className="flex items-center justify-between gap-x-6 gap-y-2">
        <div className="min-w-0 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 tabular-nums" role="status">
            {completed ? <><CheckIcon className="size-3.5" aria-hidden="true" />已读完 · {summary.totalCount} 张</> :
              <>已读 {summary.progressCount} / {summary.totalCount}<span>· 剩余 {remaining}</span></>}
          </span>
          {summary.viewCount > 0 && <span>阅读 {summary.viewCount} 次</span>}
        </div>
        {showMarkAll && <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex">
              <Button variant="ghost" size="icon" className="min-h-11 min-w-11" aria-label="标记已读完"
                title="标记已读完" aria-busy={reading.marking} disabled={markDisabled}
                onClick={() => void reading.markRead()}>
                {reading.marking ? <LoaderCircleIcon data-icon="inline-start" className="animate-spin" aria-hidden="true" /> : <CheckCheckIcon data-icon="inline-start" aria-hidden="true" />}
              </Button>
            </span>
          </TooltipTrigger>
          <TooltipContent>{reading.marking ? '正在保存已读记录…' : completed ? '已读完' : '标记已读完'}</TooltipContent>
        </Tooltip>}
      </div>
      {(!showMarkAll || errorMessage) && <p role={errorMessage ? 'alert' : undefined}
        className={showMarkAll ? 'text-xs text-destructive' : 'h-5 text-xs text-destructive'}>
        {errorMessage || '\u00a0'}
      </p>}
    </div>
  )
}
