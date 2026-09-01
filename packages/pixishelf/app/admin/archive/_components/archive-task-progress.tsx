import type { ArchiveTransferTelemetry } from '@pixishelf/job-contracts'
import { Progress } from '@/components/ui/progress'
import { archiveTaskDisplayStatus, archiveTaskStatusLabel } from './archive-task-view-state'

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
  liveTransfer?: ArchiveTransferTelemetry | null
  liveNow?: number
}

export function TaskProgress({ task, compact = false }: { task: ArchiveTaskProgressValue; compact?: boolean }) {
  const displayStatus = archiveTaskDisplayStatus(task)
  const transfer = task.liveTransfer
  const showTransfer =
    transfer &&
    ['RUNNING', 'PAUSING', 'CANCELLING'].includes(task.systemJobStatus) &&
    !['COMPLETED', 'FAILED', 'CANCELLED'].includes(displayStatus)
  return (
    <div className={compact ? 'flex w-56 min-w-0 flex-col gap-1.5' : 'flex w-full min-w-0 flex-col gap-1.5'}>
      <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className={compact ? 'max-w-20 min-w-0 flex-1 truncate' : 'min-w-0 flex-1 truncate'}>
          {task.message || archiveTaskStatusLabel(displayStatus, task.errorCode)}
        </span>
        <span className="tabular-nums">{task.progress}%</span>
      </div>
      <Progress value={task.progress} aria-label={`${task.title || task.externalId} 完成 ${task.progress}%`} />
      {showTransfer ? <ArchiveTransferStatus telemetry={transfer} now={task.liveNow ?? Date.now()} /> : null}
      {task.warning && <p className="line-clamp-2 whitespace-pre-wrap text-xs text-warning">{task.warning}</p>}
      {task.errorMessage && (
        <p className="line-clamp-2 whitespace-pre-wrap text-xs text-destructive">{task.errorMessage}</p>
      )}
      {task.retainUntil && task.status !== 'COMPLETED' && (
        <p className="text-xs text-muted-foreground">暂存保留至 {formatTaskTime(task.retainUntil)}</p>
      )}
    </div>
  )
}

export function ArchiveTransferStatus({ telemetry, now }: { telemetry: ArchiveTransferTelemetry; now: number }) {
  const stale = now - new Date(telemetry.sampledAt).getTime() > 5_000
  const speed = stale ? '速度 —' : `${formatByteAmount(telemetry.bytesPerSecond)}/s`
  const primary = telemetry.activeDownloads === 0 ? `等待远端响应${stale ? ' · 速度 —' : ''}` : speed
  const text = `${primary} · 有效已下载 ${formatByteAmount(telemetry.downloadedBytes)} · ${telemetry.activeDownloads}/${telemetry.concurrencyLimit} 路`
  return (
    <p className="truncate text-xs text-muted-foreground" title={text} aria-label={text}>
      {text}
    </p>
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

function formatByteAmount(value: number | string): string {
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

function formatTaskTime(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? '时间未知' : date.toLocaleString('zh-CN', { hour12: false })
}
