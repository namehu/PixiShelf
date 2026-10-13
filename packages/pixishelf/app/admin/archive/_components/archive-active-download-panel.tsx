'use client'

import { useEffect, useState } from 'react'
import type { ArchiveTransferItem, ArchiveTransferTelemetry } from '@pixishelf/job-contracts'
import { CirclePause, Images, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { formatByteAmount } from './archive-task-progress'
import { archiveSourceLabel } from './archive-source-label'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

export interface ActiveArchiveDownloadTask {
  id: string
  title: string | null
  providerKey: string
  externalId: string
  progress: number
  completedItems: number
  failedItems: number
  totalItems: number
  systemJobStatus: string
  liveTransfer?: ArchiveTransferTelemetry | null
}

export function ActiveArchiveDownloadPanel({
  task,
  pausePending,
  cancelPending,
  onViewItems,
  onPause,
  onCancel,
  onClose
}: {
  task: ActiveArchiveDownloadTask
  pausePending: boolean
  cancelPending: boolean
  onViewItems: () => void
  onPause: () => void
  onCancel: () => void
  onClose?: () => void
}) {
  const telemetry = task.liveTransfer
  const [now, setNow] = useState(() => Date.now())
  const hasTelemetry = Boolean(telemetry)
  useEffect(() => {
    if (!hasTelemetry) return
    // 断线后仍需将遥测标记为过期，但秒级计时只刷新下载面板，不牵动整页任务列表。
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [hasTelemetry])
  const activeItems = telemetry?.activeItems ?? []
  const activeWorkers = telemetry?.activeWorkers ?? (activeItems.length || telemetry?.activeDownloads || 0)
  const stale = telemetry ? now - new Date(telemetry.sampledAt).getTime() > 5_000 : false
  const completedItems = telemetry?.completedItems ?? task.completedItems
  const failedItems = telemetry?.failedItems ?? task.failedItems
  const totalItems = telemetry?.totalItems ?? task.totalItems
  const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : task.progress
  const pausing = task.systemJobStatus === 'PAUSING'
  const cancelling = task.systemJobStatus === 'CANCELLING'

  return (
    <section
      role="region"
      aria-label="当前归档下载"
      className="@container/download-panel flex min-h-0 min-w-0 flex-1 flex-col"
    >
      <header className="flex shrink-0 items-start gap-3 px-4 pt-4 pb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold">当前下载</h2>
            <Badge variant={!telemetry ? 'muted' : stale ? 'warning' : 'info'}>
              {!telemetry ? '准备中' : stale ? '实时数据中断' : '实时'}
            </Badge>
          </div>
          <PrivacySensitiveText
            as="p"
            className="mt-1 line-clamp-2 text-sm text-muted-foreground [overflow-wrap:anywhere]"
          >
            {task.title || archiveSourceLabel(task.providerKey, task.externalId)}
          </PrivacySensitiveText>
        </div>
        {onClose && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 shrink-0"
            aria-label="收起当前下载"
            onClick={onClose}
          >
            <X aria-hidden="true" />
          </Button>
        )}
      </header>

      <div className="min-h-0 overflow-y-auto overscroll-contain px-4 pb-4">
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-3 text-sm tabular-nums">
            <p className="min-w-0 text-muted-foreground">
              已完成 <span className="font-medium text-foreground">{completedItems}</span> / {totalItems} 张
            </p>
            <p className="shrink-0 font-medium">{progress}%</p>
          </div>
          <Progress value={progress} aria-label={`当前归档完成 ${progress}%`} />
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
            <span>{telemetry && !stale ? `${formatByteAmount(telemetry.bytesPerSecond)}/s` : '速度 —'}</span>
            <span>已下载 {telemetry ? formatByteAmount(telemetry.downloadedBytes) : '—'}</span>
          </div>
          {failedItems > 0 && <p className="text-xs text-destructive">{failedItems} 张失败，可在图片详情中重试</p>}
        </div>

        <div className="mt-4 border-t pt-3">
          <div className="mb-1 flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <h3 className="font-medium">文件进度</h3>
            {telemetry && (
              <span className="tabular-nums">
                并发 {activeWorkers}/{telemetry.concurrencyLimit}
              </span>
            )}
          </div>
          {activeItems.length > 0 ? (
            <ul className="divide-y" aria-label="活跃下载文件">
              {activeItems.map((item) => (
                <ActiveTransferItemRow key={item.itemId} item={item} stale={stale} />
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Spinner />
              {telemetry ? '正在准备下一批图片…' : '等待实时下载数据…'}
            </p>
          )}
        </div>
      </div>

      <footer className="grid shrink-0 grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-t px-4 py-3">
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-0 [&]:px-2"
          aria-label="查看全部图片"
          onClick={onViewItems}
        >
          <Images className="hidden @xs/download-panel:block" data-icon="inline-start" aria-hidden="true" />
          全部图片
        </Button>
        <Button
          type="button"
          variant="outline"
          className="h-11 min-w-0 [&]:px-2"
          aria-label={pausing ? '正在暂停' : '暂停'}
          disabled={pausePending || pausing || cancelling}
          onClick={onPause}
        >
          {pausePending ? (
            <Spinner className="hidden @xs/download-panel:block" data-icon="inline-start" />
          ) : (
            <CirclePause className="hidden @xs/download-panel:block" data-icon="inline-start" aria-hidden="true" />
          )}
          {pausing ? '暂停中' : '暂停'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="h-11 min-w-0 [&]:px-2 text-destructive hover:text-destructive"
          aria-label={cancelling ? '正在取消' : '取消'}
          disabled={cancelPending || cancelling}
          onClick={onCancel}
        >
          {cancelPending ? (
            <Spinner className="hidden @xs/download-panel:block" data-icon="inline-start" />
          ) : (
            <X className="hidden @xs/download-panel:block" data-icon="inline-start" aria-hidden="true" />
          )}
          {cancelling ? '取消中' : '取消'}
        </Button>
      </footer>
    </section>
  )
}

function ActiveTransferItemRow({ item, stale }: { item: ArchiveTransferItem; stale: boolean }) {
  const progress = transferPercentage(item.downloadedBytes, item.totalBytes)
  return (
    <li className="min-w-0 space-y-1.5 py-3" aria-label={`第 ${item.pageIndex + 1} 张图片`}>
      <div className="flex min-w-0 items-center justify-between gap-3">
        <PrivacySensitiveText as="p" className="min-w-0 truncate text-sm font-medium">
          {item.expectedFilename}
        </PrivacySensitiveText>
        <span
          className={`shrink-0 text-xs ${item.phase === 'DOWNLOADING' ? 'font-medium text-primary' : 'text-muted-foreground'}`}
        >
          {phaseLabel(item.phase)}
        </span>
      </div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <p className="min-w-0 [overflow-wrap:anywhere]">{itemDetail(item)}</p>
        {item.attempt > 1 && <span className="shrink-0">第 {item.attempt} 次</span>}
      </div>
      {progress !== null && item.phase === 'DOWNLOADING' && (
        <Progress value={progress} className="h-1" aria-label={`第 ${item.pageIndex + 1} 张下载 ${progress}%`} />
      )}
      {item.phase === 'DOWNLOADING' && item.bytesPerSecond > 0 && !stale && (
        <p className="text-xs tabular-nums text-muted-foreground">{formatByteAmount(item.bytesPerSecond)}/s</p>
      )}
    </li>
  )
}

function itemDetail(item: ArchiveTransferItem): string {
  if (item.phase === 'RESOLVING_SOURCE_PAGE') return '准备媒体地址'
  if (item.phase === 'WAITING_MEDIA_RESPONSE') return '尚未接收数据'
  if (item.phase === 'VERIFYING') return `已接收 ${formatByteAmount(item.downloadedBytes)}`
  return item.totalBytes
    ? `${formatByteAmount(item.downloadedBytes)} / ${formatByteAmount(item.totalBytes)}`
    : formatByteAmount(item.downloadedBytes)
}

function transferPercentage(downloadedBytes: string, totalBytes: string | null): number | null {
  if (!totalBytes || totalBytes === '0') return null
  const downloaded = BigInt(downloadedBytes)
  const total = BigInt(totalBytes)
  return Number((downloaded * 100n) / total > 100n ? 100n : (downloaded * 100n) / total)
}

function phaseLabel(phase: ArchiveTransferItem['phase']): string {
  const labels: Record<ArchiveTransferItem['phase'], string> = {
    RESOLVING_SOURCE_PAGE: '解析图片页',
    WAITING_MEDIA_RESPONSE: '等待图片响应',
    DOWNLOADING: '下载中',
    VERIFYING: '校验并写入'
  }
  return labels[phase]
}
