'use client'

import { useState } from 'react'
import type { ArchiveTransferItem, ArchiveTransferTelemetry } from '@pixishelf/job-contracts'
import { ChevronDown, ChevronUp, CirclePause, Images, Square } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { formatByteAmount } from './archive-task-progress'
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
  now,
  pausePending,
  cancelPending,
  onViewItems,
  onPause,
  onCancel
}: {
  task: ActiveArchiveDownloadTask
  now: number
  pausePending: boolean
  cancelPending: boolean
  onViewItems: () => void
  onPause: () => void
  onCancel: () => void
}) {
  const [mobileExpanded, setMobileExpanded] = useState(false)
  const telemetry = task.liveTransfer
  const activeItems = telemetry?.activeItems ?? []
  const activeWorkers = telemetry?.activeWorkers ?? (activeItems.length || telemetry?.activeDownloads || 0)
  const downloading =
    activeItems.length > 0
      ? activeItems.filter((item) => item.phase === 'DOWNLOADING').length
      : (telemetry?.activeDownloads ?? 0)
  const waiting = activeItems.filter((item) =>
    ['RESOLVING_SOURCE_PAGE', 'WAITING_MEDIA_RESPONSE'].includes(item.phase)
  ).length
  const verifying = activeItems.filter((item) => item.phase === 'VERIFYING').length
  const stale = telemetry ? now - new Date(telemetry.sampledAt).getTime() > 5_000 : false
  const completedItems = telemetry?.completedItems ?? task.completedItems
  const failedItems = telemetry?.failedItems ?? task.failedItems
  const totalItems = telemetry?.totalItems ?? task.totalItems
  const progress = totalItems > 0 ? Math.round((completedItems / totalItems) * 100) : task.progress
  const pausing = task.systemJobStatus === 'PAUSING'
  const cancelling = task.systemJobStatus === 'CANCELLING'

  return (
    <Card role="region" aria-label="当前归档下载" className="gap-4 overflow-hidden py-4">
      <CardHeader className="gap-3 border-b">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <CardTitle>当前下载</CardTitle>
              <Badge variant={!telemetry ? 'muted' : stale ? 'warning' : 'info'}>
                {!telemetry ? '准备中' : stale ? '实时数据中断' : '实时'}
              </Badge>
            </div>
            <PrivacySensitiveText as={CardDescription} className="mt-1 truncate">
              {task.title || `${task.providerKey} #${task.externalId}`}
            </PrivacySensitiveText>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onViewItems}>
              <Images data-icon="inline-start" aria-hidden="true" />
              查看全部图片
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pausePending || pausing || cancelling}
              onClick={onPause}
            >
              {pausePending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <CirclePause data-icon="inline-start" aria-hidden="true" />
              )}
              {pausing ? '正在暂停' : '暂停'}
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={cancelPending || cancelling}
              onClick={onCancel}
            >
              {cancelPending ? (
                <Spinner data-icon="inline-start" />
              ) : (
                <Square data-icon="inline-start" aria-hidden="true" />
              )}
              {cancelling ? '正在取消' : '取消'}
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-mono text-sm tabular-nums">
              {telemetry && !stale ? `${formatByteAmount(telemetry.bytesPerSecond)}/s` : '速度 —'}
              <span className="text-muted-foreground">
                {' '}
                · 已下载 {telemetry ? formatByteAmount(telemetry.downloadedBytes) : '—'}
              </span>
            </p>
            <p className="text-sm tabular-nums text-muted-foreground">
              {completedItems} / {totalItems} · {progress}%
            </p>
          </div>
          <Progress value={progress} aria-label={`当前归档完成 ${progress}%`} />
          {telemetry ? (
            <div className="flex flex-wrap gap-2" aria-label="当前下载槽位状态">
              <Badge variant="secondary">
                活跃任务 {activeWorkers}/{telemetry.concurrencyLimit}
              </Badge>
              <Badge variant="info">正在传输 {downloading}</Badge>
              <Badge variant="muted">等待远端 {waiting}</Badge>
              <Badge variant="outline">校验写入 {verifying}</Badge>
              {failedItems > 0 && <Badge variant="destructive">失败 {failedItems}</Badge>}
            </div>
          ) : (
            <Badge variant="muted">等待实时下载数据</Badge>
          )}
        </div>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-full sm:hidden"
          aria-expanded={mobileExpanded}
          onClick={() => setMobileExpanded((value) => !value)}
        >
          {mobileExpanded ? (
            <ChevronUp data-icon="inline-start" aria-hidden="true" />
          ) : (
            <ChevronDown data-icon="inline-start" aria-hidden="true" />
          )}
          {mobileExpanded ? '收起文件进度' : `展开文件进度（${activeItems.length}）`}
        </Button>

        <div className={mobileExpanded ? 'grid gap-2 lg:grid-cols-2' : 'hidden gap-2 sm:grid lg:grid-cols-2'}>
          {activeItems.length > 0 ? (
            activeItems.map((item) => <ActiveTransferItemRow key={item.itemId} item={item} totalItems={totalItems} />)
          ) : (
            <div className="flex items-center gap-2 rounded-lg border px-3 py-4 text-sm text-muted-foreground lg:col-span-2">
              <Spinner />
              {telemetry ? '正在准备下一批图片…' : '正在等待后台任务进程传输数据…'}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ActiveTransferItemRow({ item, totalItems }: { item: ArchiveTransferItem; totalItems: number }) {
  const progress = transferPercentage(item.downloadedBytes, item.totalBytes)
  const pageNumber = String(item.pageIndex + 1).padStart(String(Math.max(1, totalItems)).length, '0')
  return (
    <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 rounded-lg border px-3 py-2.5">
      <Badge variant="outline" className="row-span-2 font-mono">
        #{pageNumber}
      </Badge>
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <PrivacySensitiveText as="p" className="min-w-0 flex-1 truncate text-sm font-medium">
          {item.expectedFilename}
        </PrivacySensitiveText>
        <Badge variant={phaseBadgeVariant(item.phase)}>{phaseLabel(item.phase)}</Badge>
        {item.attempt > 1 && <span className="text-xs text-muted-foreground">第 {item.attempt} 次</span>}
      </div>
      <div className="flex min-w-0 items-center gap-3">
        {progress === null ? (
          <span className="min-w-0 flex-1" />
        ) : (
          <Progress
            value={progress}
            className="min-w-20 flex-1"
            aria-label={`第 ${item.pageIndex + 1} 张下载 ${progress}%`}
          />
        )}
        <p className="shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">{itemDetail(item)}</p>
      </div>
    </div>
  )
}

function itemDetail(item: ArchiveTransferItem): string {
  if (item.phase === 'RESOLVING_SOURCE_PAGE') return '准备媒体地址'
  if (item.phase === 'WAITING_MEDIA_RESPONSE') return '尚未接收数据'
  if (item.phase === 'VERIFYING') return `已接收 ${formatByteAmount(item.downloadedBytes)}`
  const amount = item.totalBytes
    ? `${formatByteAmount(item.downloadedBytes)} / ${formatByteAmount(item.totalBytes)}`
    : formatByteAmount(item.downloadedBytes)
  return item.bytesPerSecond > 0 ? `${amount} · ${formatByteAmount(item.bytesPerSecond)}/s` : amount
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

function phaseBadgeVariant(phase: ArchiveTransferItem['phase']): 'info' | 'muted' | 'secondary' | 'outline' {
  if (phase === 'DOWNLOADING') return 'info'
  if (phase === 'WAITING_MEDIA_RESPONSE') return 'muted'
  if (phase === 'VERIFYING') return 'outline'
  return 'secondary'
}
