'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Activity, ArrowRight, CheckCircle2, Loader2, XCircle } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { useTRPC } from '@/lib/trpc'
import { formatFileSize } from '@/utils/media'

interface JobView {
  id: string
  status: string
  progress: number
  message?: string | null
  error?: string | null
  result?: unknown
  targetImageId?: number | null
  targetPath?: string | null
  mode?: string | null
}

interface VideoStreamingOptimizationResult {
  imageId?: number
  path?: string
  originalSize?: number
  optimizedSize?: number
  savedBytes?: number
}

const ACTIVE_STATUSES = ['PENDING', 'RUNNING', 'CANCELLING']

export function VideoStreamingOptimizationSection() {
  const trpc = useTRPC()
  const [pollInterval, setPollInterval] = useState<number | false>(false)

  const jobQuery = useQuery(
    trpc.job.getVideoStreamingOptimizationStatus.queryOptions(undefined, {
      refetchInterval: pollInterval
    })
  )
  const job = jobQuery.data as JobView | null | undefined
  const isRunning = Boolean(job && ACTIVE_STATUSES.includes(job.status))
  const isCancelling = job?.status === 'CANCELLING'
  const result = toOptimizationResult(job?.result)

  useEffect(() => {
    setPollInterval(job && ACTIVE_STATUSES.includes(job.status) ? 1000 : false)
  }, [job?.status])

  const cancelMutation = useMutation(
    trpc.job.cancelVideoStreamingOptimization.mutationOptions({
      onSuccess: (data) => {
        if (data.success) toast.info('正在取消 MP4 无损播放优化...')
        else toast.info('当前任务已经结束')
        jobQuery.refetch()
      },
      onError: (error) => {
        toast.error(`取消优化失败: ${error.message}`)
      }
    })
  )

  return (
    <div className="flex flex-col gap-5 px-6 py-6 transition-colors hover:bg-muted/5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="space-y-1.5">
          <h4 className="font-semibold tracking-tight text-foreground">MP4 无损播放优化</h4>
          <p className="text-sm leading-relaxed text-muted-foreground">
            对 MP4 执行 stream copy + faststart，移动 moov 并重建容器索引；不会增加关键帧，也不会转换编码。
          </p>
        </div>
        {isRunning && (
          <Button
            variant="destructive"
            onClick={() => cancelMutation.mutate({ jobId: job!.id })}
            disabled={isCancelling || cancelMutation.isPending}
          >
            {isCancelling ? '正在取消...' : '取消任务'}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/10 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-medium text-foreground">从作品的媒体管理列表发起处理</p>
          <p className="text-xs text-muted-foreground">每个视频行会直接显示进度、失败原因、取消与重试；本页只保留最近任务审计。</p>
        </div>
        <Button asChild variant="outline" className="shrink-0">
          <Link href="/admin/artworks">
            前往作品管理
            <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>

      <OptimizationJobStatus job={job} isRunning={isRunning} result={result} />
    </div>
  )
}

function OptimizationJobStatus({
  job,
  isRunning,
  result
}: {
  job: JobView | null | undefined
  isRunning: boolean
  result: VideoStreamingOptimizationResult | null
}) {
  if (!job || (!isRunning && !['COMPLETED', 'FAILED', 'CANCELLED'].includes(job.status))) return null

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
      <div className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-3 text-sm">
          <div className="flex items-center gap-2 font-medium">
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : job.status === 'COMPLETED' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : job.status === 'FAILED' ? (
              <XCircle className="h-4 w-4 text-destructive" />
            ) : (
              <Activity className="h-4 w-4 text-muted-foreground" />
            )}
            <span>状态: {job.status}</span>
            {job.message && (
              <span className="hidden font-normal text-muted-foreground sm:inline"> - {job.message}</span>
            )}
          </div>
          <span className="font-medium text-muted-foreground">{job.progress ?? 0}%</span>
        </div>
        {job.message && <p className="text-sm text-muted-foreground sm:hidden">{job.message}</p>}
        {job.targetPath && (
          <p className="break-all font-mono text-xs text-muted-foreground" title={job.targetPath}>
            媒体 #{job.targetImageId ?? '-'} · {job.targetPath}
          </p>
        )}
        <Progress value={job.progress ?? 0} className="h-2" />
        {job.error && <p className="mt-2 text-sm font-medium text-destructive">错误: {job.error}</p>}
      </div>

      {job.status === 'COMPLETED' && result && (
        <div className="space-y-2 border-t bg-muted/20 px-4 py-3 text-muted-foreground">
          <p className="break-all font-mono text-xs text-foreground">{result.path || job.targetPath}</p>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <SizeStat label="优化前" value={result.originalSize} />
            <SizeStat label="优化后" value={result.optimizedSize} />
            <span>
              体积变化：
              <strong className="font-medium text-foreground">
                {result.savedBytes && result.savedBytes > 0 ? '-' : '+'}
                {formatFileSize(Math.abs(result.savedBytes ?? 0))}
              </strong>
            </span>
          </div>
        </div>
      )}
      {job.status === 'CANCELLED' && (
        <div className="border-t bg-muted/20 px-4 py-3 text-sm text-muted-foreground">任务已取消，原视频未替换</div>
      )}
    </div>
  )
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
