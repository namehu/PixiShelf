'use client'

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent
} from 'react'
import Image from 'next/image'
import { toast } from 'sonner'
import { Swiper, SwiperSlide } from 'swiper/react'
import { Keyboard, Navigation } from 'swiper/modules'
import type { Swiper as SwiperType } from 'swiper'
import { MediaType } from '@/types'
import type { RandomImageItem, ViewerMediaItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import { useShallow } from 'zustand/react/shallow'
import ImageOverlay from './image-overlay'
import type { ViewerOverlayInteractionApi } from './image-overlay'
import ViewerVideoControls, { type ViewerAudioPreference, type ViewerVideoState } from './viewer-video-controls'
import { useVideoLongPressPlaybackRate, useVideoSeekStepSeconds } from '@/components/user-setting'
import { createFeedGestureEngine, type FeedGestureEngine } from '@/components/players/video-feed-gesture-engine'
import type { VideoInteractionFeedback } from '@/components/players/video-interaction-core'
import { readMediaPreloadEnvironment, type MediaPreloadEnvironment } from '@/lib/media-preload'
import { withMediaVersion } from '@/lib/media-url'
import { isApngFile, isGifFile } from '@/lib/media'
import { Loader2Icon, PauseIcon, PlayIcon } from 'lucide-react'

// 导入 Swiper 样式
import 'swiper/css'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

interface ImageSlideProps extends Pick<SingleImageProps, 'onError'> {
  image: RandomImageItem
  isActive: boolean
  preloadEntryMedia: boolean
  audioPreference: ViewerAudioPreference
  onAudioPreferenceChange: (preference: ViewerAudioPreference) => void
  chapterPanelOpen: boolean
  onChapterPanelOpenChange: (open: boolean) => void
  onActiveMediaSettled: (result: 'ready' | 'error') => void
  onEnterClearMode: () => void
  onExitClearMode: () => void
  getPlaybackPosition: (mediaId: number) => number
  onPlaybackPositionChange: (mediaId: number, currentTime: number) => void
}

interface SingleImageProps {
  media: ViewerMediaItem
  onError?: (() => void) | undefined
  retryKey: number
  priority?: boolean
  preloadMode?: 'none' | 'eager' | 'metadata'
  shouldLoad?: boolean
  isActiveMedia?: boolean
  audioPreference: ViewerAudioPreference
  onRetry: () => void
  onVideoElementChange?: (element: HTMLVideoElement | null) => void
  onVideoStateChange?: (state: ViewerVideoState) => void
  onAutoplayMutedFallback?: () => void
  savedPlaybackPosition?: number
  onPlaybackPositionChange?: (currentTime: number) => void
  onMediaReady?: () => void
  onMediaError?: () => void
  onGestureSurfaceChange?: (element: HTMLDivElement | null) => void
  onGesturePointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onGesturePointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onGesturePointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void
  onGesturePointerCancel?: () => void
}

const INITIAL_VIDEO_STATE: ViewerVideoState = {
  currentTime: 0,
  duration: 0,
  isPlaying: false,
  isWaiting: false
}

function readVideoState(video: HTMLVideoElement, waiting = false): ViewerVideoState {
  return {
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
    duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
    isPlaying: !video.paused && !video.ended,
    isWaiting: waiting
  }
}

/**
 * 单个媒体渲染组件。视频只允许在自身同时处于纵向、横向活动状态时播放。
 */
export function SingleImage({
  media,
  onError,
  retryKey,
  onRetry,
  priority = false,
  preloadMode = 'none',
  shouldLoad = true,
  isActiveMedia = false,
  audioPreference,
  onVideoElementChange,
  onVideoStateChange,
  onAutoplayMutedFallback,
  savedPlaybackPosition = 0,
  onPlaybackPositionChange,
  onMediaReady,
  onMediaError,
  onGestureSurfaceChange,
  onGesturePointerDown,
  onGesturePointerMove,
  onGesturePointerUp,
  onGesturePointerCancel
}: SingleImageProps) {
  const [imageError, setImageError] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const autoplayMutedFallbackRef = useRef(onAutoplayMutedFallback)
  const restoredMediaIdRef = useRef<number | null>(null)
  const savedPlaybackPositionRef = useRef(savedPlaybackPosition)

  savedPlaybackPositionRef.current = savedPlaybackPosition

  useEffect(() => {
    autoplayMutedFallbackRef.current = onAutoplayMutedFallback
  }, [onAutoplayMutedFallback])

  const setVideoElement = useCallback(
    (element: HTMLVideoElement | null) => {
      videoRef.current = element
      onVideoElementChange?.(element)
    },
    [onVideoElementChange]
  )

  const publishVideoState = useCallback(
    (video: HTMLVideoElement, waiting = false) => {
      onVideoStateChange?.(readVideoState(video, waiting))
    },
    [onVideoStateChange]
  )

  const handleImageError = () => {
    setImageError(true)
    onError?.()
    onMediaError?.()
  }

  useLayoutEffect(() => {
    setImageError(false)
    restoredMediaIdRef.current = null
  }, [media.url, retryKey])

  const restorePlaybackPosition = useCallback(
    (video: HTMLVideoElement) => {
      const position = savedPlaybackPositionRef.current
      if (restoredMediaIdRef.current === media.id || position <= 0) return
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
      video.currentTime = duration ? Math.min(position, Math.max(duration - 0.1, 0)) : position
      restoredMediaIdRef.current = media.id
    },
    [media.id]
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video || media.mediaType !== MediaType.VIDEO) return

    video.muted = audioPreference.muted
    video.volume = Math.min(Math.max(audioPreference.volume, 0), 1)
  }, [audioPreference.muted, audioPreference.volume, media.mediaType])

  useEffect(() => {
    const video = videoRef.current
    if (!video || media.mediaType !== MediaType.VIDEO) return

    if (!isActiveMedia) {
      video.pause()
      publishVideoState(video)
      return
    }

    let cancelled = false
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) restorePlaybackPosition(video)
    const playResult = video.play()
    playResult?.catch(() => {
      if (cancelled || video.muted) return

      video.muted = true
      autoplayMutedFallbackRef.current?.()
      void video.play().catch(() => undefined)
    })

    return () => {
      cancelled = true
      video.pause()
    }
  }, [isActiveMedia, media.mediaType, media.url, publishVideoState, restorePlaybackPosition])

  if (!shouldLoad) {
    return (
      <div className="relative flex h-full w-full items-center justify-center bg-neutral-800">
        <div className="text-center text-white/40">
          <div className="mx-auto mb-2 flex h-16 w-16 items-center justify-center rounded-lg bg-white/10">
            <svg className="h-8 w-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
              />
            </svg>
          </div>
          <p className="text-xs">准备加载...</p>
        </div>
      </div>
    )
  }

  if (imageError) {
    return (
      <div className="relative flex h-full w-full items-center justify-center">
        <div className="absolute inset-0 flex items-center justify-center bg-neutral-900">
          <div className="text-center text-white">
            <div className="mb-4">
              <svg className="mx-auto h-16 w-16 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={1}
                  d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                />
              </svg>
            </div>
            <p className="mb-2 text-sm opacity-60">{media.mediaType === MediaType.IMAGE ? '图片' : '视频'}加载失败</p>
            <button
              type="button"
              onClick={onRetry}
              className="rounded-lg bg-white/10 px-4 py-2 text-sm transition-colors hover:bg-white/20"
            >
              重试
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div
      ref={onGestureSurfaceChange}
      className="relative flex h-full w-full items-center justify-center"
      onPointerDown={onGesturePointerDown}
      onPointerMove={onGesturePointerMove}
      onPointerUp={onGesturePointerUp}
      onPointerCancel={onGesturePointerCancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      {media.mediaType === MediaType.IMAGE ? (
        <Image
          key={`${media.key}-${retryKey}`}
          src={withMediaVersion(media.url, media.updatedAt)}
          width={window.outerWidth}
          height={window.outerHeight}
          alt={media.key || 'Artwork media'}
          className="h-full w-full object-contain"
          loading={priority || preloadMode === 'eager' ? 'eager' : 'lazy'}
          priority={priority}
          quality={100}
          onLoad={onMediaReady}
          onError={handleImageError}
        />
      ) : (
        <video
          key={`${media.key}-${retryKey}`}
          ref={setVideoElement}
          src={withMediaVersion(media.url, media.updatedAt)}
          autoPlay={isActiveMedia}
          controls={false}
          loop
          muted={audioPreference.muted}
          playsInline
          tabIndex={-1}
          className="h-full w-full object-contain"
          preload={isActiveMedia ? 'auto' : preloadMode === 'metadata' ? 'metadata' : 'none'}
          onLoadedMetadata={(event) => {
            restorePlaybackPosition(event.currentTarget)
            publishVideoState(event.currentTarget)
          }}
          onDurationChange={(event) => publishVideoState(event.currentTarget)}
          onTimeUpdate={(event) => {
            publishVideoState(event.currentTarget)
            onPlaybackPositionChange?.(event.currentTarget.currentTime)
          }}
          onPlay={(event) => publishVideoState(event.currentTarget)}
          onPlaying={(event) => publishVideoState(event.currentTarget)}
          onCanPlay={(event) => {
            publishVideoState(event.currentTarget)
            onMediaReady?.()
          }}
          onPause={(event) => publishVideoState(event.currentTarget)}
          onWaiting={(event) => publishVideoState(event.currentTarget, true)}
          onError={handleImageError}
        />
      )}
    </div>
  )
}

export function isViewerMediaPreloadEligible(media: ViewerMediaItem, environment: MediaPreloadEnvironment) {
  if (media.mediaType === MediaType.VIDEO) return true
  if (environment.saveData || ['slow-2g', '2g'].includes(environment.effectiveType ?? '')) return false

  return media.isAnimated !== true && !isApngFile(media.url) && !isGifFile(media.url)
}

function ViewerGestureFeedback({
  feedback,
  buffering
}: {
  feedback: VideoInteractionFeedback | null
  buffering: boolean
}) {
  if (!feedback && !buffering) return null

  return (
    <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center" aria-live="polite">
      <div className="flex min-h-16 min-w-16 flex-col items-center justify-center rounded-2xl bg-black/55 px-4 py-3 text-center text-white backdrop-blur-sm">
        {buffering && !feedback ? (
          <Loader2Icon className="size-7 animate-spin" />
        ) : feedback?.kind === 'playback' ? (
          feedback.title === '播放' ? (
            <PlayIcon className="size-7 fill-current" />
          ) : (
            <PauseIcon className="size-7 fill-current" />
          )
        ) : (
          <span className="text-sm font-semibold">{feedback?.title}</span>
        )}
        {feedback?.detail && <span className="mt-1 text-xs text-white/70">{feedback.detail}</span>}
      </div>
    </div>
  )
}

/**
 * 图片滑块组件，支持作品间纵向切换及作品内部的横向媒体切换。
 */
export default function ImageSlide({
  isActive,
  preloadEntryMedia,
  image,
  onError,
  audioPreference,
  onAudioPreferenceChange,
  chapterPanelOpen,
  onChapterPanelOpenChange,
  onActiveMediaSettled,
  onEnterClearMode,
  onExitClearMode,
  getPlaybackPosition,
  onPlaybackPositionChange
}: ImageSlideProps) {
  const [retryKey, setRetryKey] = useState(0)
  const [videoState, setVideoState] = useState<ViewerVideoState>(INITIAL_VIDEO_STATE)
  const [activeMediaStatus, setActiveMediaStatus] = useState<'pending' | 'ready' | 'error'>('pending')
  const [gestureFeedback, setGestureFeedback] = useState<VideoInteractionFeedback | null>(null)
  const [showBuffering, setShowBuffering] = useState(false)
  const [preloadEnvironment, setPreloadEnvironment] = useState<MediaPreloadEnvironment>({
    isMobile: true,
    saveData: false
  })
  const activeVideoRef = useRef<HTMLVideoElement | null>(null)
  const gestureSurfaceRef = useRef<HTMLDivElement | null>(null)
  const gestureEngineRef = useRef<FeedGestureEngine | null>(null)
  const overlayApiRef = useRef<ViewerOverlayInteractionApi | null>(null)
  const seekPreviewRef = useRef<{ wasPlaying: boolean } | null>(null)
  const loadedMediaIdsRef = useRef(new Set<number>())
  const failedMediaIdsRef = useRef(new Set<number>())
  const reportedStatusRef = useRef('')
  const longPressRate = useVideoLongPressPlaybackRate()
  const seekStepSeconds = useVideoSeekStepSeconds()

  useEffect(() => setPreloadEnvironment(readMediaPreloadEnvironment()), [])

  const [horizontalIndexes, setHorizontalIndex, isChromeHidden] = useViewerStore(
    useShallow((state) => [state.horizontalIndexes, state.setHorizontalIndex, state.isChromeHidden])
  )

  const fallbackMedia: ViewerMediaItem = {
    id: image.id,
    key: image.key,
    url: image.imageUrl,
    updatedAt: image.createdAt,
    mediaType: image.mediaType,
    size: null,
    width: null,
    height: null,
    isAnimated: false,
    chaptersUrl: null,
    hasAudio: null,
    duration: null
  }
  const mediaItems = image.images.length > 0 ? image.images : [fallbackMedia]
  const hasMultipleImages = mediaItems.length > 1
  const storedImageIndex = horizontalIndexes[image.key] ?? 0
  const currentImageIndex = Math.min(Math.max(storedImageIndex, 0), mediaItems.length - 1)
  const currentMedia = mediaItems[currentImageIndex] ?? fallbackMedia

  useEffect(() => {
    setVideoState({
      ...INITIAL_VIDEO_STATE,
      duration: currentMedia.mediaType === MediaType.VIDEO && currentMedia.duration ? currentMedia.duration : 0
    })
    const status = loadedMediaIdsRef.current.has(currentMedia.id)
      ? 'ready'
      : failedMediaIdsRef.current.has(currentMedia.id)
        ? 'error'
        : 'pending'
    setActiveMediaStatus(status)
    reportedStatusRef.current = ''
  }, [currentMedia.duration, currentMedia.id, currentMedia.mediaType, isActive])

  useEffect(() => {
    if (!isActive || activeMediaStatus === 'pending') return
    const token = `${currentMedia.id}:${activeMediaStatus}`
    if (reportedStatusRef.current === token) return
    reportedStatusRef.current = token
    onActiveMediaSettled(activeMediaStatus)
  }, [activeMediaStatus, currentMedia.id, isActive, onActiveMediaSettled])

  useEffect(() => {
    if (!isActive || currentMedia.mediaType !== MediaType.VIDEO || !videoState.isWaiting) {
      setShowBuffering(false)
      return
    }
    const timer = window.setTimeout(() => setShowBuffering(true), 300)
    return () => window.clearTimeout(timer)
  }, [currentMedia.mediaType, isActive, videoState.isWaiting])

  const handleRetry = () => {
    loadedMediaIdsRef.current.delete(currentMedia.id)
    failedMediaIdsRef.current.delete(currentMedia.id)
    setActiveMediaStatus('pending')
    setRetryKey((previousKey) => previousKey + 1)
  }

  const handleVideoElementChange = useCallback((element: HTMLVideoElement | null) => {
    activeVideoRef.current = element
  }, [])

  const handleAutoplayMutedFallback = useCallback(() => {
    onAudioPreferenceChange({ ...audioPreference, muted: true })
  }, [audioPreference, onAudioPreferenceChange])

  const handleTogglePlayback = useCallback(() => {
    const video = activeVideoRef.current
    if (!video) return

    if (!video.paused && !video.ended) {
      video.pause()
      setVideoState(readVideoState(video))
      return
    }

    void video.play().catch(() => {
      if (!video.muted) {
        video.muted = true
        onAudioPreferenceChange({ ...audioPreference, muted: true })
        void video.play().catch(() => toast.error('视频暂时无法播放'))
        return
      }
      toast.error('视频暂时无法播放')
    })
  }, [audioPreference, onAudioPreferenceChange])

  const handleSeek = useCallback((seconds: number) => {
    const video = activeVideoRef.current
    if (!video) return

    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
    const nextTime = duration ? Math.min(Math.max(seconds, 0), duration) : Math.max(seconds, 0)
    video.currentTime = nextTime
    setVideoState((current) => ({ ...current, currentTime: nextTime }))
  }, [])

  const handleSeekPreviewStart = useCallback(() => {
    if (seekPreviewRef.current) return
    const video = activeVideoRef.current
    if (!video) return
    const wasPlaying = !video.paused && !video.ended
    seekPreviewRef.current = { wasPlaying }
    if (wasPlaying) video.pause()
  }, [])

  const handleSeekCommit = useCallback(
    (seconds: number) => {
      const preview = seekPreviewRef.current
      seekPreviewRef.current = null
      handleSeek(seconds)
      if (preview?.wasPlaying) void activeVideoRef.current?.play().catch(() => undefined)
    },
    [handleSeek]
  )

  const handleSeekPreviewCancel = useCallback(() => {
    const preview = seekPreviewRef.current
    seekPreviewRef.current = null
    if (preview?.wasPlaying) void activeVideoRef.current?.play().catch(() => undefined)
  }, [])

  useEffect(() => {
    window.addEventListener('blur', handleSeekPreviewCancel)
    return () => {
      window.removeEventListener('blur', handleSeekPreviewCancel)
      handleSeekPreviewCancel()
    }
  }, [handleSeekPreviewCancel])

  const handleToggleMuted = useCallback(() => {
    const nextMuted = !audioPreference.muted
    if (activeVideoRef.current) activeVideoRef.current.muted = nextMuted
    onAudioPreferenceChange({ ...audioPreference, muted: nextMuted })
  }, [audioPreference, onAudioPreferenceChange])

  const handleVolumeChange = useCallback(
    (volume: number) => {
      const nextVolume = Math.min(Math.max(volume, 0), 1)
      const nextMuted = nextVolume === 0
      if (activeVideoRef.current) {
        activeVideoRef.current.volume = nextVolume
        activeVideoRef.current.muted = nextMuted
      }
      onAudioPreferenceChange({ volume: nextVolume, muted: nextMuted })
    },
    [onAudioPreferenceChange]
  )

  useEffect(() => {
    gestureEngineRef.current?.destroy()
    gestureEngineRef.current = null
    if (!isActive) return

    const engine = createFeedGestureEngine({
      mediaKind: currentMedia.mediaType === MediaType.VIDEO ? 'video' : 'image',
      longPressRate,
      seekStepSeconds,
      getSurfaceRect: () => gestureSurfaceRef.current?.getBoundingClientRect() ?? { left: 0, width: 0 },
      getPlaying: () => {
        const video = activeVideoRef.current
        return Boolean(video && !video.paused && !video.ended)
      },
      getCurrentTime: () => activeVideoRef.current?.currentTime ?? 0,
      getDuration: () => activeVideoRef.current?.duration ?? currentMedia.duration ?? 0,
      getPlaybackRate: () => activeVideoRef.current?.playbackRate ?? 1,
      setPlaybackRate: (rate) => {
        if (activeVideoRef.current) activeVideoRef.current.playbackRate = rate
      },
      onTogglePlayback: handleTogglePlayback,
      onSeek: handleSeek,
      onLike: (point) => overlayApiRef.current?.likeAt(point),
      onOpenActions: () => overlayApiRef.current?.openActions(),
      getChromeHidden: () => isChromeHidden,
      onExitClearMode,
      onFeedback: setGestureFeedback
    })
    gestureEngineRef.current = engine
    return () => {
      engine.destroy()
      if (gestureEngineRef.current === engine) gestureEngineRef.current = null
    }
  }, [
    currentMedia.duration,
    currentMedia.id,
    currentMedia.mediaType,
    handleSeek,
    handleTogglePlayback,
    isActive,
    isChromeHidden,
    longPressRate,
    onExitClearMode,
    seekStepSeconds
  ])

  useEffect(() => {
    if (!isActive || currentMedia.mediaType !== MediaType.VIDEO) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' || chapterPanelOpen) return
      const target = event.target as HTMLElement | null
      if (target?.closest('button, input, select, textarea, [role="slider"], [role="dialog"]')) return
      event.preventDefault()
      handleTogglePlayback()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chapterPanelOpen, currentMedia.mediaType, handleTogglePlayback, isActive])

  const gestureHandlers = {
    onGestureSurfaceChange: (element: HTMLDivElement | null) => {
      gestureSurfaceRef.current = element
    },
    onGesturePointerDown: (event: ReactPointerEvent<HTMLDivElement>) => gestureEngineRef.current?.pointerDown(event),
    onGesturePointerMove: (event: ReactPointerEvent<HTMLDivElement>) => gestureEngineRef.current?.pointerMove(event),
    onGesturePointerUp: (event: ReactPointerEvent<HTMLDivElement>) => gestureEngineRef.current?.pointerUp(event),
    onGesturePointerCancel: () => gestureEngineRef.current?.pointerCancel()
  }

  const handleMediaReady = (mediaId: number) => {
    loadedMediaIdsRef.current.add(mediaId)
    failedMediaIdsRef.current.delete(mediaId)
    if (isActive && mediaId === currentMedia.id) setActiveMediaStatus('ready')
  }
  const handleMediaError = (mediaId: number) => {
    failedMediaIdsRef.current.add(mediaId)
    loadedMediaIdsRef.current.delete(mediaId)
    if (isActive && mediaId === currentMedia.id) setActiveMediaStatus('error')
  }

  const buildMediaProps = (media: ViewerMediaItem, index: number) => {
    const isCurrent = index === currentImageIndex
    const isActiveCurrent = isActive && isCurrent
    const isStagedEntry =
      !isActive && isCurrent && preloadEntryMedia && isViewerMediaPreloadEligible(media, preloadEnvironment)
    const isStagedHorizontal =
      isActive &&
      activeMediaStatus === 'ready' &&
      index === currentImageIndex + 1 &&
      isViewerMediaPreloadEligible(media, preloadEnvironment)
    const shouldLoad = isActiveCurrent || isStagedEntry || isStagedHorizontal
    const preloadMode = isActiveCurrent
      ? media.mediaType === MediaType.IMAGE
        ? ('eager' as const)
        : ('none' as const)
      : shouldLoad
        ? media.mediaType === MediaType.VIDEO
          ? ('metadata' as const)
          : ('eager' as const)
        : ('none' as const)

    return {
      shouldLoad,
      preloadMode,
      priority: isActiveCurrent && media.mediaType === MediaType.IMAGE,
      isActiveMedia: isActiveCurrent && media.mediaType === MediaType.VIDEO,
      onMediaReady: () => handleMediaReady(media.id),
      onMediaError: () => handleMediaError(media.id),
      onVideoElementChange: isCurrent ? handleVideoElementChange : undefined,
      onVideoStateChange: isCurrent ? setVideoState : undefined,
      onAutoplayMutedFallback: isCurrent ? handleAutoplayMutedFallback : undefined,
      savedPlaybackPosition: getPlaybackPosition(media.id),
      onPlaybackPositionChange: (currentTime: number) => onPlaybackPositionChange(media.id, currentTime),
      ...(isActiveCurrent ? gestureHandlers : {})
    }
  }

  const handleSlideChange = (swiper: SwiperType) => {
    onChapterPanelOpenChange(false)
    setHorizontalIndex(image.key, swiper.activeIndex)
  }

  const mediaControls =
    isActive && currentMedia.mediaType === MediaType.VIDEO ? (
      <ViewerVideoControls
        media={currentMedia}
        state={videoState}
        audioPreference={audioPreference}
        onTogglePlayback={handleTogglePlayback}
        onSeek={handleSeek}
        onSeekPreviewStart={handleSeekPreviewStart}
        onSeekCommit={handleSeekCommit}
        onSeekPreviewCancel={handleSeekPreviewCancel}
        onToggleMuted={handleToggleMuted}
        onVolumeChange={handleVolumeChange}
        chapterPanelOpen={chapterPanelOpen}
        onChapterPanelOpenChange={onChapterPanelOpenChange}
      />
    ) : null

  const overlay = (
    <ImageOverlay
      isActive={isActive}
      image={image}
      mediaControls={mediaControls}
      onInteractionApiChange={(api) => {
        overlayApiRef.current = api
      }}
      onEnterClearMode={onEnterClearMode}
    />
  )

  if (!hasMultipleImages) {
    return (
      <>
        <SingleImage
          media={currentMedia}
          audioPreference={audioPreference}
          onError={onError}
          retryKey={retryKey}
          onRetry={handleRetry}
          {...buildMediaProps(currentMedia, 0)}
        />
        {overlay}
        <ViewerGestureFeedback feedback={gestureFeedback} buffering={showBuffering} />
      </>
    )
  }

  return (
    <>
      <Swiper
        modules={[Navigation, Keyboard]}
        direction="horizontal"
        slidesPerView={1}
        lazyPreloadPrevNext={0}
        spaceBetween={0}
        initialSlide={currentImageIndex}
        keyboard={{ enabled: isActive && !chapterPanelOpen, onlyInViewport: true }}
        navigation={{ nextEl: '.swiper-button-next-custom', prevEl: '.swiper-button-prev-custom' }}
        onSlideChange={handleSlideChange}
        touchRatio={1}
        touchAngle={45}
        grabCursor
        resistance
        resistanceRatio={0.85}
        speed={300}
        nested
        className="relative z-10 h-full w-full"
      >
        {mediaItems.map((media, index) => (
          <SwiperSlide key={media.key}>
            <SingleImage
              media={media}
              audioPreference={audioPreference}
              onError={index === currentImageIndex ? onError : undefined}
              retryKey={retryKey}
              onRetry={handleRetry}
              {...buildMediaProps(media, index)}
            />
          </SwiperSlide>
        ))}
      </Swiper>

      {!isChromeHidden && (
        <>
          <div className="swiper-pagination-custom absolute !bottom-0.5 left-4 right-4 z-30">
            <div className="flex w-full gap-1">
              {mediaItems.map((media, index) => (
                <div
                  key={media.key}
                  className={`h-1 flex-1 rounded-full transition-all duration-300 ease-out ${
                    index <= currentImageIndex ? 'bg-white' : 'bg-white/20'
                  }`}
                />
              ))}
            </div>
          </div>
          <div className="absolute right-4 top-4 z-30 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
            {currentImageIndex + 1} / {mediaItems.length}
          </div>
        </>
      )}

      {overlay}
      <ViewerGestureFeedback feedback={gestureFeedback} buffering={showBuffering} />
    </>
  )
}
