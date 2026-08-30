'use client'

import { PlayCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ScheduledTaskView } from './task-ui'

interface VideoMediaProbeFailedSample {
  stage: 'PROBE' | 'POSTER'
  imageId: number
  path: string
  error: string
}

export interface VideoMediaProbeResult {
  mode?: 'INCREMENTAL' | 'RECHECK_HAS_AUDIO'
  classification?: {
    videos?: number
    images?: number
    animations?: number
    unknown?: number
    metadataRowsCreated?: number
  }
  probe?: { total?: number; processed?: number; failed?: number; remaining?: number }
  poster?: {
    total?: number
    processed?: number
    generated?: number
    skipped?: number
    failed?: number
    remaining?: number
  }
  failedSamples?: VideoMediaProbeFailedSample[]
}

export function VideoProbeTaskActions({
  task,
  isPending,
  triggeringTaskKey,
  onTrigger
}: {
  task: ScheduledTaskView | undefined
  isPending: boolean
  triggeringTaskKey: string | null
  onTrigger: (task: ScheduledTaskView, mode: 'INCREMENTAL' | 'RECHECK_HAS_AUDIO') => void
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => task && onTrigger(task, 'INCREMENTAL')} disabled={!task || isPending}>
        {triggeringTaskKey === `${task?.key}:INCREMENTAL` ? (
          <Spinner data-icon="inline-start" aria-hidden="true" />
        ) : (
          <PlayCircle data-icon="inline-start" aria-hidden="true" />
        )}
        增量执行
      </Button>
      <Button
        variant="outline"
        onClick={() => task && onTrigger(task, 'RECHECK_HAS_AUDIO')}
        disabled={!task || isPending}
      >
        {triggeringTaskKey === `${task?.key}:RECHECK_HAS_AUDIO` ? (
          <Spinner data-icon="inline-start" aria-hidden="true" />
        ) : (
          <PlayCircle data-icon="inline-start" aria-hidden="true" />
        )}
        校准现有有音频
      </Button>
    </div>
  )
}
