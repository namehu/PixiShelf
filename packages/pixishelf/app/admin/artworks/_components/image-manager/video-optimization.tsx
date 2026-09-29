'use client'

import { CheckCircle2, RotateCcw, WandSparkles, X, XCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'
import type { ImageListItem } from '../types'
import {
  ACTIVE_VIDEO_OPTIMIZATION_STATUSES,
  isActiveVideoOptimization,
  type VideoOptimizationJobView
} from '@/types/video-optimization'
import { isVideoImageListItem } from './utils'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

export type VideoOptimizationJob = VideoOptimizationJobView
export { ACTIVE_VIDEO_OPTIMIZATION_STATUSES, isActiveVideoOptimization }

export function isMp4OptimizationTarget(image: ImageListItem) {
  return isVideoImageListItem(image) && image.path.toLowerCase().endsWith('.mp4')
}

interface ImageVideoOptimizationEntryProps {
  image: ImageListItem
  job?: VideoOptimizationJob | null
  isStarting?: boolean
  compact?: boolean
  onStart: (image: ImageListItem) => void
  onCancel: (job: VideoOptimizationJob) => void
}

export function ImageVideoOptimizationEntry({
  image,
  job,
  isStarting = false,
  compact = false,
  onStart,
  onCancel
}: ImageVideoOptimizationEntryProps) {
  if (!isVideoImageListItem(image)) return compact ? null : <span className="text-xs text-muted-foreground">-</span>

  if (!isMp4OptimizationTarget(image)) {
    return (
      <Badge variant="warning" title="第一阶段仅支持 MP4 无损重新封装；该格式需要后续转码功能">
        需转码
      </Badge>
    )
  }

  if (isStarting) {
    return (
      <Badge variant="info">
        <Spinner data-icon="inline-start" aria-hidden="true" />
        正在启动
      </Badge>
    )
  }

  if (job && isActiveVideoOptimization(job)) {
    const cancelling = job.status === 'CANCELLING'
    const pending = job.status === 'PENDING'
    return (
      <div className={cn('min-w-0', compact ? 'w-32' : 'w-44')}>
        <div className="mb-1 flex items-center gap-1 text-[11px] font-medium">
          {pending ? (
            <span className="size-3 shrink-0 rounded-full border border-warning" />
          ) : (
            <Spinner className="size-3 shrink-0 text-primary" aria-hidden="true" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {pending
              ? `排队中${job.queuePosition ? ` · 第 ${job.queuePosition} 位` : ''}`
              : cancelling
                ? '正在取消'
                : '无损重新封装'}
          </span>
          {!pending && <span>{job.progress ?? 0}%</span>}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-5 shrink-0"
            disabled={cancelling}
            aria-label={`取消 ${image.path} 的视频优化任务`}
            onClick={(event) => {
              event.stopPropagation()
              onCancel(job)
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </div>
        {!pending && <Progress value={job.progress ?? 0} className="h-1" />}
      </div>
    )
  }

  if (job?.status === 'FAILED') {
    return (
      <div className={cn('min-w-0', compact ? 'max-w-32' : 'w-44')}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          title="处理失败，点击重试"
          onClick={(event) => {
            event.stopPropagation()
            onStart(image)
          }}
        >
          <XCircle data-icon="inline-start" aria-hidden="true" />
          失败，重试
        </Button>
        {!compact && (
          <PrivacySensitiveText as="p" className="mt-1 truncate text-[10px] text-destructive">
            {job.error || '未知错误'}
          </PrivacySensitiveText>
        )}
      </div>
    )
  }

  if (job?.status === 'COMPLETED') {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs text-success"
        title="已完成 MP4 无损播放优化；点击可再次执行"
        onClick={(event) => {
          event.stopPropagation()
          onStart(image)
        }}
      >
        <CheckCircle2 data-icon="inline-start" aria-hidden="true" />
        已优化
      </Button>
    )
  }

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-7 px-2 text-xs"
      title={job?.status === 'CANCELLED' ? '任务已取消，点击重试' : 'MP4 无损播放优化'}
      onClick={(event) => {
        event.stopPropagation()
        onStart(image)
      }}
    >
      {job?.status === 'CANCELLED' ? (
        <RotateCcw data-icon="inline-start" aria-hidden="true" />
      ) : (
        <WandSparkles data-icon="inline-start" aria-hidden="true" />
      )}
      {job?.status === 'CANCELLED' ? '已取消，重试' : '无损优化'}
    </Button>
  )
}
