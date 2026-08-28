'use client'

import VideoPlayer, { type VideoPlayerSettingAction } from '@/components/players/video-player'
import ApngPlayer from '@/components/players/apng-player'
import AnimatedWebpPlayer from '@/components/players/animated-webp-player'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkStore } from '@/store/use-artwork-store'
import Image from 'next/image'
import { memo, useMemo } from 'react'
import { useOnInView } from 'react-intersection-observer'
import { isApngFile, isGifFile, isVideoFile, isWebpFile } from '@/lib/media'
import { isConfirmedStaticWebp } from '@/lib/media-animation'
import { combinationApiResource } from '@/utils/combination-static'
import { Loader2, X } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { useArtworkVideoOptimization } from './artwork-video-optimization-context'

interface LazyMediaProps {
  media: ArtworkImageResponseDto
  index: number
}

/**
 * 懒加载媒体组件
 */
const LazyMedia = memo(({ media, index }: LazyMediaProps) => {
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const { job, isStarting, canManage, suspendPlayback, enqueue, cancel } = useArtworkVideoOptimization(media.id)
  const src = media.path
  const hasDimensions = Boolean(media.width && media.height && media.width > 0 && media.height > 0)
  const aspectRatio = hasDimensions ? `${media.width} / ${media.height}` : undefined
  const videoSettingActions = useMemo<VideoPlayerSettingAction[]>(() => {
    if (!canManage || !isVideoFile(src)) return []

    const isMp4 = media.path.toLowerCase().endsWith('.mp4')
    const completed = job?.status === 'COMPLETED'
    const tooltip = !isMp4
      ? '需要转码'
      : completed
        ? '已优化'
        : job?.status === 'FAILED'
          ? '失败，重试'
          : job?.status === 'CANCELLED'
            ? '重新执行'
            : '执行'

    return [
      {
        name: 'video-streaming-optimization',
        label: '无损优化',
        tooltip,
        disabled: !isMp4 || completed,
        onClick: isMp4 && !completed && enqueue ? () => enqueue(media) : undefined
      }
    ]
  }, [canManage, enqueue, job?.status, media, src])

  const trackingRef = useOnInView(
    (inView) => {
      if (inView) setCurrentIndex(index)
    },
    { rootMargin: '-45% 0px -45% 0px', threshold: 0 }
  )

  // 主渲染逻辑
  const renderContent = () => {
    if (isVideoFile(src)) {
      if (suspendPlayback) {
        const pending = job?.status === 'PENDING'
        const cancelling = job?.status === 'CANCELLING'
        const statusText = isStarting
          ? '正在提交优化任务...'
          : pending
            ? `排队中${job.queuePosition ? ` · 第 ${job.queuePosition} 位` : ''}`
            : cancelling
              ? '正在取消优化...'
              : job?.message || '正在无损优化视频...'
        return (
          <div className="flex min-h-72 w-full flex-col items-center justify-center gap-3 bg-foreground px-6 text-background">
            <Loader2 className="size-7 animate-spin" />
            <p className="text-sm font-medium">优化处理中</p>
            <p className="text-xs text-background/60">{statusText}</p>
            {!isStarting && !pending && (
              <div className="flex w-full max-w-sm items-center gap-3">
                <Progress value={job?.progress ?? 0} className="h-1.5 flex-1 bg-background/20" />
                <span className="text-xs text-background/70">{job?.progress ?? 0}%</span>
              </div>
            )}
            {job && cancel && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="mt-1 border-background/20 bg-background/5 text-background hover:bg-background/10 hover:text-background"
                disabled={cancelling}
                onClick={() => cancel(job)}
              >
                {cancelling ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : <X className="mr-1.5 size-3.5" />}
                {pending ? '取消排队' : '取消优化'}
              </Button>
            )}
            <p className="text-xs text-background/50">
              {cancelling ? '取消完成后会恢复播放器' : '处理完成后会刷新整个作品页'}
            </p>
          </div>
        )
      }
      const mediaSrc = appendMediaVersion(combinationApiResource(src), media.updatedAt)
      return (
        <VideoPlayer
          src={mediaSrc}
          chaptersUrl={media.chaptersUrl}
          chaptersCount={media.chaptersCount}
          keyframesUrl={media.keyframesUrl}
          keyframeCount={media.keyframeCount}
          hasAudio={media.hasAudio}
          size={media.size}
          className="w-full h-auto"
          preload="metadata"
          settingActions={videoSettingActions}
        />
      )
    }

    if ((isApngFile(src) || /\.png$/i.test(src)) && media.isAnimated) {
      return <ApngPlayer src={src} alt={`Artwork animation ${index + 1}`} />
    }

    if ((isWebpFile(src) && !isConfirmedStaticWebp(media)) || (isGifFile(src) && media.isAnimated)) {
      const formatLabel = isGifFile(src) ? 'GIF' : 'WEBP'
      return (
        <AnimatedWebpPlayer
          src={src}
          alt={`Artwork ${formatLabel} ${index + 1}`}
          size={media.size}
          isAnimated={Boolean(media.isAnimated)}
          formatLabel={formatLabel}
        />
      )
    }

    // 普通图片
    return (
      <Image
        src={src}
        alt={`Artwork part ${index + 1}`}
        priority={index < 4}
        loading={index < 4 ? 'eager' : 'lazy'}
        width={0}
        height={0}
        sizes="100vw"
        className={hasDimensions ? 'h-auto w-full' : 'h-auto min-h-[300px] w-full sm:min-h-[500px]'}
      />
    )
  }

  return (
    <div
      ref={trackingRef}
      className="relative flex w-full items-center justify-center overflow-hidden bg-muted"
      style={{ aspectRatio }}
    >
      {renderContent()}
    </div>
  )
})

function appendMediaVersion(src: string, updatedAt: string) {
  const separator = src.includes('?') ? '&' : '?'
  return `${src}${separator}v=${encodeURIComponent(updatedAt)}`
}

export default LazyMedia
