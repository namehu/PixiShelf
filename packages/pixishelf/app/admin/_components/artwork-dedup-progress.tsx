import type { JobProgressData, JobStatus } from '@pixishelf/job-contracts'
import { Progress } from '@/components/ui/progress'
import { artworkDedupProgressPresentation } from '@/lib/job-progress'
import { cn } from '@/lib/utils'

export function ArtworkDedupProgress({
  status,
  stage,
  progressData,
  className,
  showPhase = true,
  showWait = true
}: {
  status: JobStatus
  stage?: string | null
  progressData?: JobProgressData | null
  className?: string
  showPhase?: boolean
  showWait?: boolean
}) {
  const progress = artworkDedupProgressPresentation({ status, stage, progressData })
  const label = showPhase ? progress.label : progress.countLabel
  return (
    <div className={cn('flex flex-col gap-2 text-xs text-muted-foreground', className)}>
      {label ? <p className="tabular-nums">{label}</p> : null}
      {!progress.isComplete && !['CANCELLED', 'FAILED', 'SKIPPED'].includes(status) && progress.hasSnapshot ? (
        progress.value === null ? (
          <div role="progressbar" aria-label="当前阶段进度" aria-valuetext={progress.label} className="h-1.5 overflow-hidden rounded-full bg-primary/20">
            <div className="h-full w-1/3 animate-pulse bg-primary motion-reduce:animate-none" />
          </div>
        ) : (
          <Progress value={progress.value} aria-label="当前阶段进度" aria-valuetext={progress.label} className="h-1.5" />
        )
      ) : null}
      {showWait && progress.waitLabel ? <p>{progress.waitLabel}</p> : null}
      {progress.isComplete && progress.uncheckedMedia !== null && progress.uncheckedMedia > 0 ? (
        <p className="text-warning">{progress.uncheckedMedia.toLocaleString('zh-CN')} 项媒体未核对，已支持的图片仍参与比较。</p>
      ) : null}
    </div>
  )
}
