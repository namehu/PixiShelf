'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { CheckCircle2, Clock3, Film, Loader2, RotateCcw, X, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useTRPC } from '@/lib/trpc'
import { isActiveVideoOptimization, type VideoOptimizationJobView } from '@/types/video-optimization'
import { formatFileSize } from '@/utils/media'
import { TaskSection } from './task-ui'

interface VideoOptimizationQueueView {
  capacity: number
  active: VideoOptimizationJobView[]
  recent: VideoOptimizationJobView[]
}

interface VideoStreamingOptimizationResult {
  path?: string
  originalSize?: number
  optimizedSize?: number
  savedBytes?: number
}

export function VideoStreamingOptimizationSection() {
  const trpc = useTRPC()
  const [pollInterval, setPollInterval] = useState<number | false>(false)
  const queueQuery = useQuery(
    trpc.job.getVideoStreamingOptimizationQueue.queryOptions(undefined, {
      refetchInterval: pollInterval
    })
  )
  const queue = queueQuery.data as VideoOptimizationQueueView | undefined

  useEffect(() => {
    setPollInterval(queue?.active.length ? 1000 : false)
  }, [queue?.active.length])

  const cancelMutation = useMutation(
    trpc.job.cancelVideoStreamingOptimization.mutationOptions({
      onSuccess: (data) => {
        toast.info(data.success ? '任务取消请求已提交' : '该任务已经结束')
        void queueQuery.refetch()
      },
      onError: (error) => toast.error(`取消优化失败：${error.message}`)
    })
  )
  const retryMutation = useMutation(
    trpc.job.startVideoStreamingOptimization.mutationOptions({
      onSuccess: (data) => {
        if (data.reused) {
          toast.info(data.queuePosition ? `该视频已在队列第 ${data.queuePosition} 位` : '该视频正在优化')
        } else {
          toast.success(data.queuePosition ? `已重新加入队列，第 ${data.queuePosition} 位` : '已开始优化')
        }
        setPollInterval(1000)
        void queueQuery.refetch()
      },
      onError: (error) => toast.error(`重新加入队列失败：${error.message}`)
    })
  )

  const active = queue?.active ?? []
  const recent = queue?.recent ?? []
  const runningCount = active.filter((job) => job.status === 'RUNNING' || job.status === 'CANCELLING').length
  const pendingCount = active.filter((job) => job.status === 'PENDING').length

  return (
    <TaskSection
      id="video-streaming"
      category="持久队列"
      icon={Film}
      title="MP4 无损播放优化队列"
      description="从作品详情或媒体管理提交，任务按顺序串行执行；仅做 stream copy + faststart，不重新编码。"
      summary={
        runningCount > 0
          ? `${runningCount} 项运行中 · ${pendingCount} 项等待`
          : pendingCount > 0
            ? `${pendingCount} 项等待执行`
            : `队列空闲 · ${recent.length} 条近期记录`
      }
      tone={active.length > 0 ? 'active' : 'idle'}
    >
      <QueueGroup title="正在处理与等待" emptyText="当前没有等待或执行中的视频优化任务">
        {active.map((job) => (
          <OptimizationJobRow
            key={job.id}
            job={job}
            onCancel={() => cancelMutation.mutate({ jobId: job.id })}
            cancelling={cancelMutation.isPending && cancelMutation.variables?.jobId === job.id}
          />
        ))}
      </QueueGroup>

      <QueueGroup title="近期记录（保留 90 天）" emptyText="还没有视频优化记录">
        {recent.map((job) => (
          <OptimizationJobRow
            key={job.id}
            job={job}
            onRetry={
              job.targetImageId && ['FAILED', 'CANCELLED'].includes(job.status)
                ? () => retryMutation.mutate({ imageId: job.targetImageId! })
                : undefined
            }
            retrying={retryMutation.isPending && retryMutation.variables?.imageId === job.targetImageId}
          />
        ))}
      </QueueGroup>
    </TaskSection>
  )
}

function QueueGroup({ title, emptyText, children }: { title: string; emptyText: string; children: React.ReactNode }) {
  const hasChildren = Array.isArray(children) ? children.length > 0 : Boolean(children)
  return (
    <section className="space-y-2">
      <h4 className="text-sm font-medium text-foreground">{title}</h4>
      {hasChildren ? (
        <div className="space-y-2">{children}</div>
      ) : (
        <p className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">{emptyText}</p>
      )}
    </section>
  )
}

function OptimizationJobRow({
  job,
  onCancel,
  onRetry,
  cancelling = false,
  retrying = false
}: {
  job: VideoOptimizationJobView
  onCancel?: () => void
  onRetry?: () => void
  cancelling?: boolean
  retrying?: boolean
}) {
  const active = isActiveVideoOptimization(job)
  const pending = job.status === 'PENDING'
  const result = toOptimizationResult(job.result)

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="space-y-3 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
              <JobStatusIcon status={job.status} />
              <span>{getStatusLabel(job)}</span>
              {job.attempt && job.attempt > 1 ? <Badge variant="outline">第 {job.attempt} 次执行</Badge> : null}
            </div>
            <p className="break-all font-mono text-xs text-muted-foreground" title={job.targetPath ?? undefined}>
              媒体 #{job.targetImageId ?? '-'} · {job.targetPath || '路径未知'}
            </p>
            {job.createdAt && <p className="text-xs text-muted-foreground">提交于 {formatDateTime(job.createdAt)}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {onCancel && active && (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={job.status === 'CANCELLING' || cancelling}
                onClick={onCancel}
              >
                {cancelling || job.status === 'CANCELLING' ? (
                  <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
                ) : (
                  <X className="size-4" aria-hidden="true" />
                )}
                {pending ? '取消排队' : '取消任务'}
              </Button>
            )}
            {onRetry && (
              <Button type="button" size="sm" variant="outline" disabled={retrying} onClick={onRetry}>
                <RotateCcw
                  className={`size-4 ${retrying ? 'animate-spin motion-reduce:animate-none' : ''}`}
                  aria-hidden="true"
                />
                重新加入队列
              </Button>
            )}
          </div>
        </div>

        {active && !pending && (
          <div className="flex items-center gap-3">
            <Progress value={job.progress} className="h-2 flex-1" aria-label={`优化进度 ${job.progress}%`} />
            <span className="text-xs font-medium tabular-nums text-muted-foreground">{job.progress}%</span>
          </div>
        )}
        {job.error && <p className="break-words text-sm font-medium text-destructive">错误：{job.error}</p>}
      </div>

      {job.status === 'COMPLETED' && result && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
          <SizeStat label="优化前" value={result.originalSize} />
          <SizeStat label="优化后" value={result.optimizedSize} />
          <span>
            体积变化：
            <strong className="font-medium text-foreground">
              {(result.savedBytes ?? 0) > 0 ? '-' : '+'}
              {formatFileSize(Math.abs(result.savedBytes ?? 0))}
            </strong>
          </span>
        </div>
      )}
    </div>
  )
}

function JobStatusIcon({ status }: { status: string }) {
  if (status === 'PENDING') return <Clock3 className="size-4 text-amber-500" aria-hidden="true" />
  if (status === 'RUNNING' || status === 'CANCELLING') {
    return <Loader2 className="size-4 animate-spin text-primary motion-reduce:animate-none" aria-hidden="true" />
  }
  if (status === 'COMPLETED') return <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
  return <XCircle className="size-4 text-destructive" aria-hidden="true" />
}

function getStatusLabel(job: VideoOptimizationJobView) {
  if (job.status === 'PENDING') return `排队中${job.queuePosition ? ` · 第 ${job.queuePosition} 位` : ''}`
  if (job.status === 'RUNNING') return job.message || '正在优化'
  if (job.status === 'CANCELLING') return '正在取消'
  if (job.status === 'COMPLETED') return '优化完成'
  if (job.status === 'CANCELLED') return '已取消'
  return '优化失败'
}

function SizeStat({ label, value }: { label: string; value?: number }) {
  return (
    <span>
      {label}：<strong className="font-medium text-foreground">{formatFileSize(value ?? 0)}</strong>
    </span>
  )
}

function toOptimizationResult(result: unknown): VideoStreamingOptimizationResult | null {
  return result && typeof result === 'object' ? (result as VideoStreamingOptimizationResult) : null
}

function formatDateTime(value: Date | string) {
  return new Date(value).toLocaleString('zh-CN')
}
