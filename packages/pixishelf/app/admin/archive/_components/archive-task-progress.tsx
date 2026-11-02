import { Progress } from '@/components/ui/progress'
import { archiveTaskDisplayStatus } from './archive-task-view-state'

interface ArchiveTaskProgressValue {
  title: string | null
  externalId: string
  status: string
  systemJobStatus: string
  progress: number
  message: string | null
  errorCode: string | null
  warning: string | null
  errorMessage: string | null
  retainUntil: Date | string | null
}

export function TaskProgress({ task }: { task: ArchiveTaskProgressValue }) {
  const displayStatus = archiveTaskDisplayStatus(task)
  if (!['RUNNING', 'CANCELLING'].includes(displayStatus)) return null
  return (
    <div className="flex w-full min-w-0 flex-col gap-1.5">
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span>进度</span>
        <span className="tabular-nums">{task.progress}%</span>
      </div>
      <Progress value={task.progress} aria-label={`${task.title || task.externalId} 完成 ${task.progress}%`} />
    </div>
  )
}

export function ArchiveImageCounts({
  task
}: {
  task: { completedItems: number; failedItems: number; totalItems: number }
}) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap text-xs tabular-nums"
      aria-label={`图片数量：成功 ${task.completedItems}，失败 ${task.failedItems}，总数 ${task.totalItems}`}
    >
      <span>{task.completedItems}</span>
      <span aria-hidden="true" className="text-muted-foreground">
        /
      </span>
      <span className="text-destructive">{task.failedItems}</span>
      <span aria-hidden="true" className="text-muted-foreground">
        /
      </span>
      <span>{task.totalItems}</span>
    </span>
  )
}

export function formatByteAmount(value: number | string): string {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1_024) return `${Math.round(bytes)} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let amount = bytes / 1_024
  let unit = units[0]!
  for (let index = 1; index < units.length && amount >= 1_024; index += 1) {
    amount /= 1_024
    unit = units[index]!
  }
  return `${Number(amount.toFixed(amount >= 10 ? 1 : 2))} ${unit}`
}
