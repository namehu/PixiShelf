'use client'

import { useEffect, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Check, Pause, Play, RotateCcw, Sparkles, X } from 'lucide-react'
import Image from 'next/image'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { confirm } from '@/components/shared/global-confirm'
import { useVideoKeyframeRetryClock } from '@/hooks/use-video-keyframe-retry-clock'
import { useTRPC } from '@/lib/trpc'
import { formatVideoKeyframeError, getVideoKeyframeRetryCountdown } from '@/types/video-keyframe'

export function VideoKeyframePanel({ imageId, visible }: { imageId: number; visible: boolean }) {
  const trpc = useTRPC()
  const [pollInterval, setPollInterval] = useState<number | false>(false)
  const details = useQuery(
    trpc.job.getVideoKeyframeDetails.queryOptions({ imageId }, { enabled: visible, refetchInterval: pollInterval })
  )
  const job = details.data?.job
  const published = details.data?.published
  const retryClock = useVideoKeyframeRetryClock([job])
  const retryCountdown = getVideoKeyframeRetryCountdown(job, retryClock)

  useEffect(() => {
    setPollInterval(job && ['PENDING', 'RUNNING', 'PAUSING', 'CANCELLING'].includes(job.status) ? 1000 : false)
  }, [job])

  const start = useMutation(
    trpc.job.startVideoKeyframeGeneration.mutationOptions({
      onSuccess: () => {
        toast.success('视频代表帧任务已提交')
        setPollInterval(1000)
        void details.refetch()
      },
      onError: (error) => toast.error(`提交失败: ${error.message}`)
    })
  )
  const control = useMutation(
    trpc.job.controlVideoKeyframe.mutationOptions({
      onSuccess: () => void details.refetch(),
      onError: (error) => toast.error(`操作失败: ${error.message}`)
    })
  )
  const retry = useMutation(
    trpc.job.retryVideoKeyframe.mutationOptions({
      onSuccess: () => {
        setPollInterval(1000)
        void details.refetch()
      },
      onError: (error) => toast.error(`重试失败: ${error.message}`)
    })
  )
  const selectPoster = useMutation(
    trpc.job.selectVideoKeyframePoster.mutationOptions({
      onSuccess: () => {
        toast.success('正式视频封面已更新')
        void details.refetch()
      },
      onError: (error) => {
        toast.error(`生成正式封面失败: ${error.message}`)
        void details.refetch()
      }
    })
  )

  const active = Boolean(job && ['PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING'].includes(job.status))

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            视频代表帧
            {published ? <Badge variant="outline">{published.publishedCount} 张</Badge> : null}
            {job?.queuePosition ? <Badge variant="outline">队列 #{job.queuePosition}</Badge> : null}
            {published?.warning ? (
              <Badge variant="warning">
                有警告
              </Badge>
            ) : null}
          </div>
          {job ? <p className="mt-1 text-xs text-muted-foreground">{job.message || job.status}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {!active ? (
            <Button
              size="sm"
              variant="outline"
              disabled={start.isPending}
              onClick={() => {
                if (!published) {
                  start.mutate({ imageId, force: false })
                  return
                }
                confirm({
                  title: '重新生成视频代表帧？',
                  description: '现有代表帧会被新的生成结果替换，当前手动封面将尽量保留。',
                  confirmText: '确认重建',
                  variant: 'destructive',
                  onConfirm: () => start.mutate({ imageId, force: true })
                })
              }}
            >
              {start.isPending ? (
                <Spinner data-icon="inline-start" aria-hidden="true" />
              ) : published ? (
                <RotateCcw data-icon="inline-start" aria-hidden="true" />
              ) : (
                <Sparkles data-icon="inline-start" aria-hidden="true" />
              )}
              {published ? '强制重建' : '生成代表帧'}
            </Button>
          ) : null}
          {job?.status === 'RUNNING' ? (
            <Button size="sm" variant="outline" onClick={() => control.mutate({ jobId: job.id, action: 'pause' })}>
              <Pause data-icon="inline-start" aria-hidden="true" />
              暂停
            </Button>
          ) : null}
          {job?.status === 'PAUSED' ? (
            <Button size="sm" variant="outline" onClick={() => control.mutate({ jobId: job.id, action: 'resume' })}>
              <Play data-icon="inline-start" aria-hidden="true" />
              恢复
            </Button>
          ) : null}
          {active && job ? (
            <Button
              size="sm"
              variant="destructive"
              disabled={job.status === 'CANCELLING'}
              onClick={() =>
                confirm({
                  title: '取消视频代表帧任务？',
                  description: '当前生成会停止；已经发布的正式封面不会被删除。',
                  confirmText: '确认取消',
                  variant: 'destructive',
                  onConfirm: () => control.mutate({ jobId: job.id, action: 'cancel' })
                })
              }
            >
              <X data-icon="inline-start" aria-hidden="true" />
              取消
            </Button>
          ) : null}
          {job && ['FAILED', 'CANCELLED'].includes(job.status) ? (
            <Button size="sm" variant="outline" onClick={() => retry.mutate({ jobId: job.id })}>
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              重试
            </Button>
          ) : null}
        </div>
      </div>

      {job && ['RUNNING', 'CANCELLING'].includes(job.status) ? (
        <div className="flex items-center gap-2">
          <Progress value={job.progress} className="h-2 flex-1" />
          <span className="text-xs">{job.progress}%</span>
        </div>
      ) : null}
      {job?.error ? <p className="text-xs text-destructive">{formatVideoKeyframeError(job.error)}</p> : null}
      {retryCountdown ? <p className="text-xs text-warning-foreground">{retryCountdown}</p> : null}
      {published?.warning ? <p className="text-xs text-warning-foreground">{published.warning}</p> : null}
      {details.data?.manualPosterWarning ? (
        <p className="text-xs text-warning-foreground">正式封面保留为旧版本：{details.data.manualPosterWarning}</p>
      ) : null}

      {published?.frames.length ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {published.frames.map((frame) => (
            <div key={frame.id} className="group overflow-hidden rounded-md border bg-black">
              <div className="relative aspect-video w-full">
                <Image
                  src={frame.url}
                  alt={`视频 ${formatTime(frame.captureTime)} 代表帧`}
                  fill
                  sizes="(min-width: 640px) 210px, 50vw"
                  className="object-contain"
                />
              </div>
              <div className="flex items-center justify-between gap-1 bg-background p-1.5">
                <span className="text-[11px] text-muted-foreground">{formatTime(frame.captureTime)}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-1.5 text-[11px]"
                  disabled={selectPoster.isPending}
                  onClick={() => selectPoster.mutate({ imageId, frameId: frame.id })}
                >
                  <Check data-icon="inline-start" aria-hidden="true" />
                  设为封面
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">尚未生成视频代表帧。</p>
      )}
    </div>
  )
}

function formatTime(seconds: number) {
  const total = Math.max(0, Math.round(seconds))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remaining = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${minutes}:${String(remaining).padStart(2, '0')}`
}
