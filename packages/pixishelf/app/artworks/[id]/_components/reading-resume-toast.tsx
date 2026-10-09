'use client'

import { useEffect } from 'react'
import { BookmarkIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export function ReadingResumeToast({ index, onJump, onStart, onDismiss }: {
  index: number
  onJump: () => void
  onStart: () => void
  onDismiss: () => void
}) {
  useEffect(() => {
    const timer = window.setTimeout(onDismiss, 8000)
    return () => window.clearTimeout(timer)
  }, [onDismiss])

  return (
    <div className="w-[var(--width)] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl bg-popover text-popover-foreground shadow-floating" role="status">
      <div className="flex items-start gap-3 px-4 pt-4">
        <BookmarkIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <p className="text-sm">上次看到第 <span className="font-medium tabular-nums">{index + 1}</span> 张，是否继续？</p>
      </div>
      <div className="flex justify-end gap-3 px-4 pb-2 pt-1">
        <Button variant="link" size="sm" className="px-0 text-muted-foreground" onClick={onStart}>从头开始</Button>
        <Button variant="link" size="sm" className="px-0" onClick={onJump}>跳转</Button>
      </div>
      <div className="h-0.5 bg-primary/10" aria-hidden="true">
        <div className="h-full origin-left bg-primary motion-safe:animate-[reading-resume-countdown_8s_linear_forwards]" />
      </div>
    </div>
  )
}
