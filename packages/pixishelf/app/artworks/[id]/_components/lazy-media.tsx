'use client'

import VideoPlayer, { type VideoPlayerSettingAction } from '@/components/players/video-player'
import ApngPlayer from '@/components/players/apng-player'
import AnimatedWebpPlayer from '@/components/players/animated-webp-player'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkStore } from '@/store/use-artwork-store'
import Image from 'next/image'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useArtworkAutoBrowseStore, type PreviewStatus } from '@/store/use-artwork-auto-browse-store'
import { useOnInView } from 'react-intersection-observer'
import { isApngFile, isGifFile, isVideoFile, isWebpFile } from '@/lib/media'
import { hasReliableSingleFrameDimensions, isConfirmedStaticWebp } from '@/lib/media-animation'
import { combinationApiResource } from '@/utils/combination-static'
import { Loader2, X } from 'lucide-react'
import { Progress } from '@/components/ui/progress'
import { Button } from '@/components/ui/button'
import { useArtworkAnimation } from './use-artwork-animation'
import { useArtworkVideoOptimization } from './artwork-video-optimization-context'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'

interface LazyMediaProps {
  media: ArtworkImageResponseDto
  index: number
  onPreviewStatusChange?: (status: PreviewStatus) => void
  reading?: ArtworkReadingHandle
  trackingActive?: boolean
}

/**
 * 懒加载媒体组件
 */
const LazyMedia = memo(({ media, index, onPreviewStatusChange, reading, trackingActive = true }: LazyMediaProps) => {
  const [previewStatus, setPreviewStatus] = useState<PreviewStatus>('loading')
  const [visible, setVisible] = useState(false)
  const { job, isStarting, canManage, suspendPlayback, enqueue, cancel } = useArtworkVideoOptimization(media.id)
  const autoMode = useArtworkAutoBrowseStore((state) => state.mode)
  const autoStatus = useArtworkAutoBrowseStore((state) => state.status)
  const automatic = autoMode === 'scroll' && ['running', 'waiting'].includes(autoStatus)
  const surfaceId = `detail-${media.id}`
  const observe = reading?.observe
  const clearSurface = reading?.clearSurface
  const observationEpoch = reading?.observationEpoch
  useEffect(() => {
    if (!observe || !clearSurface) return
    observe(surfaceId, {
      mediaId: media.id,
      ready: previewStatus === 'ready' && !suspendPlayback,
      visible,
      automatic,
      active: trackingActive,
      priority: 0
    })
    return () => clearSurface(surfaceId)
  }, [automatic, clearSurface, media.id, observationEpoch, observe, previewStatus, surfaceId,
    suspendPlayback, trackingActive, visible])
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const report = useCallback(
    (status: PreviewStatus) => {
      if (!live.current) return
      setPreviewStatus(status)
      onPreviewStatusChange?.(status)
    },
    [onPreviewStatusChange]
  )
  useEffect(() => {
    if (suspendPlayback) report('loading')
  }, [report, suspendPlayback])
  const onLoad = useCallback(
    (event: React.SyntheticEvent<HTMLImageElement>) => {
      const image = event.currentTarget
      if (!image.decode) {
        report('ready')
        return
      }
      void image.decode().then(
        () => report('ready'),
        () => report(image.naturalWidth > 0 ? 'ready' : 'error')
      )
    },
    [report]
  )
  const onPlayingChange = useCallback((playing: boolean) => {
    if (playing) useArtworkAutoBrowseStore.getState().pause('manual')
  }, [])
  const setCurrentIndex = useArtworkStore((state) => state.setCurrentIndex)
  const playbackActive = useArtworkAutoBrowseStore((state) => state.activeVideoId === media.id && !state.previewOpen)
  const playbackPaused = useArtworkAutoBrowseStore((state) => state.pausedVideoIds.includes(media.id))
  const animation = useArtworkAnimation(media.id, 'scroll', `${media.path}:${media.updatedAt}`)
  const src = media.path
  const hasDimensions =
    hasReliableSingleFrameDimensions(media) &&
    Boolean(media.width && media.height && media.width > 0 && media.height > 0)
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
      setVisible(inView)
      if (inView) {
        setCurrentIndex(index)
        if (!useArtworkAutoBrowseStore.getState().previewOpen) {
          useArtworkAutoBrowseStore.getState().setCurrentMedia(media.id)
        }
      }
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
          playbackActive={playbackActive}
          playbackPaused={playbackPaused}
          onPlaybackIntent={(playing) => useArtworkAutoBrowseStore.getState().setVideoPaused(media.id, !playing)}
          onPlay={(automatic) => {
            const state = useArtworkAutoBrowseStore.getState()
            if (automatic) {
              // 保留 video 暂停原因，继续按钮才能将该视频记为本轮已跳过，避免立即再次停住。
              if (!state.skippedIds.includes(media.id)) {
                state.setCurrentMedia(media.id)
                state.pause('video')
              }
            } else onPlayingChange(true)
          }}
          onReady={() => report('ready')}
          onError={() => report('error')}
        />
      )
    }

    if ((isApngFile(src) || /\.png$/i.test(src)) && media.isAnimated) {
      return (
        <ApngPlayer
          src={src}
          alt={`Artwork animation ${index + 1}`}
          onPosterLoad={() => report('ready')}
          onPosterError={() => report('error')}
          onPlayingChange={onPlayingChange}
        />
      )
    }

    if ((isWebpFile(src) && !isConfirmedStaticWebp(media)) || (isGifFile(src) && media.isAnimated)) {
      const formatLabel = isGifFile(src) ? 'GIF' : 'WEBP'
      return (
        <AnimatedWebpPlayer
          src={src}
          alt={`Artwork ${formatLabel} ${index + 1}`}
          size={media.size}
          animationMetadata={media.animationMetadata}
          isAnimated={Boolean(media.isAnimated)}
          formatLabel={formatLabel}
          controlMode={isWebpFile(src) ? 'badge' : 'surface'}
          {...(isWebpFile(src) ? animation : {})}
          updatedAt={media.updatedAt}
          onPosterLoad={() => report('ready')}
          onPosterError={() => report('error')}
          onPlayingChange={isWebpFile(src) ? animation.onPlayingChange : onPlayingChange}
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
        onLoad={onLoad}
        onError={() => report('error')}
      />
    )
  }

  return (
    <div
      ref={trackingRef}
      className="relative flex w-full items-center justify-center overflow-hidden bg-muted"
      style={{ aspectRatio }}
      data-auto-media-id={media.id}
      data-video-media={isVideoFile(src) ? 'true' : undefined}
      data-preview-status={previewStatus}
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
