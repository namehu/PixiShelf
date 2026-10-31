'use client'

import { useVideoPlaybackSource } from '@/hooks/use-video-playback-source'
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
import { Keyboard } from 'swiper/modules'
import type { Swiper as SwiperType } from 'swiper'
import { MediaType } from '@/types'
import type { RandomImageItem, ViewerMediaItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import { useShallow } from 'zustand/react/shallow'
import ImageOverlay from './image-overlay'
import type { ViewerOverlayInteractionApi } from './image-overlay'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { useVideoReading, type VideoReadingProgress } from '@/lib/reading/use-video-reading'
import type { ViewerPlaybackRate } from './viewer-playback-rate'
import ViewerVideoControls, { type ViewerAudioPreference, type ViewerVideoState } from './viewer-video-controls'
import { useVideoLongPressPlaybackRate, useVideoSeekStepSeconds } from '@/components/user-setting'
import AnimatedWebpPlayer from '@/components/players/animated-webp-player'
import { createFeedGestureEngine, type FeedGestureEngine } from '@/components/players/video-feed-gesture-engine'
import type { VideoInteractionFeedback } from '@/components/players/video-interaction-core'
import { readMediaPreloadEnvironment, type MediaPreloadEnvironment } from '@/lib/media-preload'
import { withMediaVersion } from '@/lib/media-url'
import { isApngFile, isGifFile, isWebpFile } from '@/lib/media'
import { ViewerGestureFeedback } from './viewer-gesture-feedback'
import { Button } from '@/components/ui/button'
import ViewerImageProgress from './viewer-image-progress'
import { useViewerAutoMedia } from './use-viewer-auto-media'
import { combinationApiResource } from '@/utils/combination-static'
import type { VideoZoom } from '@/components/players/video-zoom-button'

import 'swiper/css'

interface ImageSlideProps extends Pick<SingleImageProps, 'onError'> {
  playbackRate: ViewerPlaybackRate
  onPlaybackRateChange: (rate: ViewerPlaybackRate) => void
  onArtworkComplete?: () => void
  onCancelArtworkComplete?: () => void
  navigationBlocked?: boolean
  navigationTransitioning?: boolean
  isNavigationBlocked?: () => boolean
  image: RandomImageItem
  isActive: boolean
  preloadEntryMedia: boolean
  audioPreference: ViewerAudioPreference
  onAudioPreferenceChange: (preference: ViewerAudioPreference) => void
  chapterPanelOpen: boolean
  onChapterPanelOpenChange: (open: boolean) => void
  onActiveMediaSettled: (result: 'ready' | 'error') => void
  onToggleChrome: () => void
  getPlaybackPosition: (mediaId: number) => number
  onPlaybackPositionChange: (mediaId: number, currentTime: number) => void
  reading?: ArtworkReadingHandle
  interactionLocked?: boolean
  onOverlayPanelOpenChange?: (open: boolean) => void
}

interface SingleImageProps {
  sourceSwitchDisabled?: boolean
  videoZoom?: VideoZoom
  playbackRate?: ViewerPlaybackRate
  autoPlayback?: 'running' | 'paused'
  autoRestartKey?: number
  autoRestartPending?: boolean
  onMediaComplete?: () => void
  onPlaybackError?: () => void
  onAnimationReady?: () => void
  onAnimationBuffering?: () => void
  onAutoPause?: () => void
  chromeHidden?: boolean
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
  onReadingProgress?: (progress: VideoReadingProgress) => void
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

const VIEWER_CONTROL_SELECTOR =
  'a, button, input, select, textarea, [contenteditable], [role="slider"], [data-viewer-control]'

function isNativePngAnimation(media: ViewerMediaItem) {
  return (
    isApngFile(media.url) ||
    media.animationMetadata?.format === 'APNG' ||
    Boolean(media.isAnimated && /\.png$/i.test(media.url))
  )
}

function readVideoState(video: HTMLVideoElement, waiting = false): ViewerVideoState {
  return {
    currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
    duration: Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0,
    isPlaying: !video.paused && !video.ended,
    isWaiting: waiting
  }
}

export function SingleImage(props: SingleImageProps) {
  const ignoreControl = (event: ReactPointerEvent<HTMLDivElement>) =>
    event.target instanceof Element && Boolean(event.target.closest(VIEWER_CONTROL_SELECTOR))
  return (
    <div
      ref={props.onGestureSurfaceChange}
      className="relative flex h-full w-full items-center justify-center"
      onPointerDown={(event) => {
        if (ignoreControl(event)) props.onGesturePointerCancel?.()
        else props.onGesturePointerDown?.(event)
      }}
      onPointerMove={props.onGesturePointerMove}
      onPointerUp={props.onGesturePointerUp}
      onPointerCancel={props.onGesturePointerCancel}
      onContextMenu={(event) => event.preventDefault()}
    >
      <SingleImageContent {...props} />
    </div>
  )
}

function SingleImageContent({
  sourceSwitchDisabled = false,
  videoZoom = 1,
  playbackRate = 1,
  autoPlayback,
  autoRestartKey = 0,
  autoRestartPending = false,
  onMediaComplete,
  onPlaybackError,
  onAnimationReady,
  onAnimationBuffering,
  onAutoPause,
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
  onReadingProgress,
  onAutoplayMutedFallback,
  savedPlaybackPosition = 0,
  onPlaybackPositionChange,
  onMediaReady,
  onMediaError,
  chromeHidden = false
}: SingleImageProps) {
  const [imageError, setImageError] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const playbackSource = useVideoPlaybackSource(
    media.mediaType === MediaType.VIDEO ? media.id : undefined,
    withMediaVersion(media.url, media.updatedAt),
    shouldLoad,
    retryKey
  )
  const playingBeforeSourceError = useRef(false)
  const playbackRateRef = useRef(playbackRate)
  playbackRateRef.current = playbackRate
  const readingStartedRef = useRef(false)
  const autoplayMutedFallbackRef = useRef(onAutoplayMutedFallback)
  const restoredMediaIdRef = useRef<number | null>(null)
  const savedPlaybackPositionRef = useRef(savedPlaybackPosition)
  const callbacks = useRef({ onMediaComplete, onPlaybackError })
  callbacks.current = { onMediaComplete, onPlaybackError }
  const previousAuto = useRef(autoPlayback)
  const appliedRestart = useRef(0)

  savedPlaybackPositionRef.current = savedPlaybackPosition

  useEffect(() => {
    autoplayMutedFallbackRef.current = onAutoplayMutedFallback
  }, [onAutoplayMutedFallback])

  const setVideoElement = useCallback(
    (element: HTMLVideoElement | null) => {
      const changed = videoRef.current !== element
      if (changed) readingStartedRef.current = false
      videoRef.current = element
      if (element && changed) {
        element.defaultPlaybackRate = playbackRateRef.current
        element.playbackRate = playbackRateRef.current
      }
      onVideoElementChange?.(element)
    },
    [onVideoElementChange]
  )

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    video.defaultPlaybackRate = playbackRate
    video.playbackRate = playbackRate
  }, [playbackRate])

  const publishVideoState = useCallback(
    (video: HTMLVideoElement, waiting = false) => {
      onVideoStateChange?.(readVideoState(video, waiting))
      onReadingProgress?.({
        currentTime: video.currentTime,
        duration: video.duration,
        started: readingStartedRef.current,
        playing: !video.paused && !video.ended && !waiting
      })
    },
    [onVideoStateChange, onReadingProgress]
  )

  const handleImageError = () => {
    setImageError(true)
    onError?.()
    onMediaError?.()
  }

  useEffect(() => {
    if (playbackSource.error) handleImageError()
  }, [playbackSource.error])
  useLayoutEffect(() => {
    setImageError(false)
    restoredMediaIdRef.current = null
  }, [media.url, retryKey])

  const restorePlaybackPosition = useCallback(
    (video: HTMLVideoElement) => {
      if (autoRestartPending && autoRestartKey && appliedRestart.current !== autoRestartKey) {
        video.currentTime = 0
        appliedRestart.current = autoRestartKey
        restoredMediaIdRef.current = media.id
        useViewerStore.getState().consumeAutoBrowseRestart(autoRestartKey)
        return
      }
      const position = savedPlaybackPositionRef.current
      if (restoredMediaIdRef.current === media.id || position <= 0) return
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
      video.currentTime = duration ? Math.min(position, Math.max(duration - 0.1, 0)) : position
      restoredMediaIdRef.current = media.id
    },
    [media.id, autoRestartKey, autoRestartPending]
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
    const wasManaged = previousAuto.current !== undefined
    previousAuto.current = autoPlayback
    if (!isActiveMedia) {
      video.pause()
      publishVideoState(video)
      return
    }

    let cancelled = false
    if (video.readyState >= HTMLMediaElement.HAVE_METADATA) restorePlaybackPosition(video)
    if (autoPlayback === 'paused') {
      video.pause()
      publishVideoState(video)
      return
    }
    if (wasManaged && autoPlayback === undefined) return
    if (
      autoPlayback === 'running' &&
      Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.currentTime >= video.duration
    ) {
      publishVideoState(video)
      callbacks.current.onMediaComplete?.()
      return
    }
    if (!playbackSource.src || playbackSource.switching || (!playbackSource.allowAutoplay && autoPlayback !== 'running')) return
    const playResult = video.play()
    playResult?.catch(() => {
      if (cancelled || (video.error && playbackSource.usingPlayback)) return
      if (video.muted) {
        callbacks.current.onPlaybackError?.()
        return
      }

      video.muted = true
      autoplayMutedFallbackRef.current?.()
      void video.play().catch(() => {
        if (!cancelled) callbacks.current.onPlaybackError?.()
      })
    })

    return () => {
      cancelled = true
    }
  }, [
    isActiveMedia,
    media.mediaType,
    media.url,
    publishVideoState,
    restorePlaybackPosition,
    autoPlayback,
    retryKey,
    playbackSource.src
  ])
  useEffect(() => {
    const video = videoRef.current
    return () => {
      video?.pause()
    }
  }, [media.url, retryKey])

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

  if (imageError || playbackSource.error) {
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
            <p className="mb-2 text-sm opacity-60">
              {playbackSource.error ?? `${media.mediaType === MediaType.IMAGE ? '图片' : '视频'}加载失败`}
            </p>
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

  const usesAnimatedImagePlayer =
    media.mediaType === MediaType.IMAGE && (isWebpFile(media.url) || (isGifFile(media.url) && media.isAnimated))
  const nativeAnimation = Boolean(autoPlayback && isNativePngAnimation(media))

  return (
    <div className="relative flex h-full w-full items-center justify-center overflow-hidden">
      {usesAnimatedImagePlayer ? (
        <AnimatedWebpPlayer
          key={`${media.key}:${retryKey}`}
          src={media.url}
          alt={media.key || 'Artwork media'}
          size={media.size}
          animationMetadata={media.animationMetadata}
          isAnimated={Boolean(media.isAnimated)}
          formatLabel={isGifFile(media.url) ? 'GIF' : 'WEBP'}
          updatedAt={media.updatedAt}
          fillContainer
          controlMode={chromeHidden ? 'external' : 'badge'}
          className="[&>button[data-long-press-ignore]]:bottom-auto [&>button[data-long-press-ignore]]:top-[max(4rem,calc(env(safe-area-inset-top)+3.5rem))]"
          posterLoading={priority || preloadMode === 'eager' ? 'eager' : 'lazy'}
          onPosterLoad={onMediaReady}
          onPosterError={handleImageError}
          playing={
            media.isAnimated
              ? autoPlayback
                ? isWebpFile(media.url)
                  ? autoPlayback === 'running'
                  : true
                : !isActiveMedia
                  ? false
                  : undefined
              : undefined
          }
          playOnce={Boolean(autoPlayback && media.isAnimated && isWebpFile(media.url))}
          playbackPaused={autoPlayback === 'paused' && isWebpFile(media.url)}
          playbackKey={`${media.key}:${autoRestartKey}:${retryKey}`}
          onPlayingChange={(playing) => {
            if (media.isAnimated && autoPlayback && !playing) onAutoPause?.()
          }}
          onAnimationReady={onAnimationReady}
          onAnimationBuffering={onAnimationBuffering}
          onAnimationComplete={onMediaComplete}
          onAnimationError={handleImageError}
        />
      ) : media.mediaType === MediaType.IMAGE ? (
        <Image
          key={`${media.key}-${retryKey}`}
          src={withMediaVersion(nativeAnimation ? combinationApiResource(media.url) : media.url, media.updatedAt)}
          unoptimized={nativeAnimation}
          width={window.outerWidth}
          height={window.outerHeight}
          alt={media.key || 'Artwork media'}
          className="h-full w-full object-contain"
          loading={priority || preloadMode === 'eager' ? 'eager' : 'lazy'}
          priority={priority}
          quality={100}
          onLoad={() => {
            onMediaReady?.()
            if (nativeAnimation) onAnimationReady?.()
          }}
          onError={handleImageError}
        />
      ) : (
        <video
          key={`${media.key}-${retryKey}`}
          ref={setVideoElement}
          src={playbackSource.src}
          autoPlay={
            isActiveMedia && autoPlayback !== 'paused' && playbackSource.allowAutoplay && !playbackSource.switching
          }
          controls={false}
          loop={!autoPlayback}
          muted={audioPreference.muted}
          playsInline
          tabIndex={-1}
          className="h-full w-full object-contain"
          style={{ scale: videoZoom }}
          preload={isActiveMedia ? 'auto' : preloadMode === 'metadata' ? 'metadata' : 'none'}
          onLoadedMetadata={(event) => {
            const sourceRestored = playbackSource.restore(
              event.currentTarget,
              isActiveMedia && autoPlayback !== 'paused'
            )
            event.currentTarget.defaultPlaybackRate = playbackRateRef.current
            event.currentTarget.playbackRate = playbackRateRef.current
            if (!sourceRestored) restorePlaybackPosition(event.currentTarget)
            publishVideoState(event.currentTarget)
          }}
          onDurationChange={(event) => publishVideoState(event.currentTarget)}
          onTimeUpdate={(event) => {
            publishVideoState(event.currentTarget)
            onPlaybackPositionChange?.(event.currentTarget.currentTime)
          }}
          onPlay={(event) => {
            playingBeforeSourceError.current = true
            publishVideoState(event.currentTarget)
          }}
          onPlaying={(event) => {
            readingStartedRef.current = true
            publishVideoState(event.currentTarget)
          }}
          onSeeked={(event) => publishVideoState(event.currentTarget)}
          onEnded={(event) => {
            publishVideoState(event.currentTarget)
            onPlaybackPositionChange?.(event.currentTarget.currentTime)
            onMediaComplete?.()
          }}
          onCanPlay={(event) => {
            publishVideoState(event.currentTarget)
            onMediaReady?.()
          }}
          onPause={(event) => {
            if (!event.currentTarget.error) playingBeforeSourceError.current = false
            publishVideoState(event.currentTarget)
          }}
          onWaiting={(event) => publishVideoState(event.currentTarget, true)}
          onError={() => {
            if (!playbackSource.handleError(videoRef.current, playingBeforeSourceError.current)) handleImageError()
          }}
        />
      )}
      {media.mediaType === MediaType.VIDEO && playbackSource.hasPlayback && isActiveMedia && !chromeHidden && (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute left-3 top-16"
          data-viewer-control
          disabled={sourceSwitchDisabled}
          aria-label={playbackSource.usingPlayback ? '切换到原片' : '切换到流畅副本'}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            playbackSource.switchSource(videoRef.current)
          }}
        >
          {playbackSource.usingPlayback ? '流畅' : '原片'}
        </Button>
      )}
    </div>
  )
}

export function isViewerMediaPreloadEligible(media: ViewerMediaItem, environment: MediaPreloadEnvironment) {
  if (media.mediaType === MediaType.VIDEO) return true
  if (environment.saveData || ['slow-2g', '2g'].includes(environment.effectiveType ?? '')) return false

  return media.isAnimated !== true && !isApngFile(media.url) && !isGifFile(media.url)
}

export default function ImageSlide({
  playbackRate,
  onPlaybackRateChange,
  onArtworkComplete,
  onCancelArtworkComplete,
  navigationBlocked = false,
  navigationTransitioning = false,
  isNavigationBlocked,
  isActive,
  preloadEntryMedia,
  image,
  onError,
  audioPreference,
  onAudioPreferenceChange,
  chapterPanelOpen,
  onChapterPanelOpenChange,
  onActiveMediaSettled,
  onToggleChrome,
  getPlaybackPosition,
  onPlaybackPositionChange,
  reading,
  interactionLocked = false,
  onOverlayPanelOpenChange
}: ImageSlideProps) {
  const [retryKey, setRetryKey] = useState(0)
  const [swiper, setSwiper] = useState<SwiperType | null>(null)
  const [horizontalTransition, setHorizontalTransition] = useState(false)
  const [seeking, setSeeking] = useState(false)
  const [animationReady, setAnimationReady] = useState(false)
  const [playbackFailed, setPlaybackFailed] = useState(false)
  const autoStatus = useViewerStore((state) => state.autoBrowseStatus)
  const autoRestart = useViewerStore((state) => state.autoBrowseRestart)
  useEffect(() => {
    if (!swiper || swiper.destroyed) return
    swiper.allowTouchMove = isActive && !interactionLocked && !chapterPanelOpen
    if (isActive && !interactionLocked && !chapterPanelOpen) swiper.keyboard.enable()
    else swiper.keyboard.disable()
  }, [isActive, interactionLocked, chapterPanelOpen, swiper])
  const [videoState, setVideoState] = useState<ViewerVideoState>(INITIAL_VIDEO_STATE)
  const [videoZoom, setVideoZoom] = useState<VideoZoom>(1)
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
  const seekResumeAllowedRef = useRef(false)
  seekResumeAllowedRef.current = isActive && !interactionLocked && !chapterPanelOpen
  const loadedMediaIdsRef = useRef(new Set<number>())
  const failedMediaIdsRef = useRef(new Set<number>())
  const reportedStatusRef = useRef('')
  const longPressRate = useVideoLongPressPlaybackRate()
  const seekStepSeconds = useVideoSeekStepSeconds()

  useEffect(() => setPreloadEnvironment(readMediaPreloadEnvironment()), [])

  const [horizontalIndexes, setHorizontalIndex, isChromeHidden] = useViewerStore(
    useShallow((state) => [state.horizontalIndexes, state.setHorizontalIndex, state.isChromeHidden])
  )
  useEffect(() => {
    gestureEngineRef.current?.pointerCancel()
  }, [isChromeHidden])

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
    duration: null,
    animationMetadata: null
  }
  const mediaItems = image.images.length > 0 ? image.images : [fallbackMedia]
  const hasMultipleImages = mediaItems.length > 1
  const storedImageIndex = horizontalIndexes[image.key] ?? 0
  const currentImageIndex = Math.min(Math.max(storedImageIndex, 0), mediaItems.length - 1)
  const currentMedia = mediaItems[currentImageIndex] ?? fallbackMedia
  useEffect(() => {
    setVideoZoom(1)
  }, [currentMedia.id, currentMedia.url, currentMedia.updatedAt, isActive])
  const autoRestartKey = autoRestart?.mediaId === currentMedia.id ? autoRestart.revision : 0
  const activeIdentity = `${image.id}:${currentMedia.id}:${currentMedia.updatedAt}:${retryKey}:${autoRestartKey}`
  const mediaIdentityRef = useRef(activeIdentity)
  mediaIdentityRef.current = activeIdentity
  const animation =
    currentMedia.mediaType === MediaType.IMAGE &&
    currentMedia.isAnimated &&
    (isWebpFile(currentMedia.url) || isGifFile(currentMedia.url))
  const singleLoop = animation && isWebpFile(currentMedia.url)
  const blocked = interactionLocked || chapterPanelOpen || navigationBlocked || horizontalTransition || seeking
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const advance = () => {
    if (currentImageIndex + 1 < mediaItems.length && swiper && !swiper.destroyed) {
      const next = mediaItems[currentImageIndex + 1]!
      useViewerStore.getState().restartAutoBrowseMedia(next.id)
      swiper.slideTo(currentImageIndex + 1)
    } else onArtworkComplete?.()
  }
  const autoMedia = useViewerAutoMedia({
    mediaKey: activeIdentity,
    active: isActive,
    ready: animation || isNativePngAnimation(currentMedia) ? animationReady : activeMediaStatus === 'ready',
    failed: activeMediaStatus === 'error' || playbackFailed,
    timed: currentMedia.mediaType === MediaType.IMAGE && !singleLoop,
    blocked,
    timingBlocked: interactionLocked || chapterPanelOpen || navigationTransitioning || horizontalTransition,
    isBlocked: () => blockedRef.current || Boolean(swiper?.animating) || Boolean(isNavigationBlocked?.()),
    advance
  })
  useEffect(() => {
    if (!autoMedia.selected) setAnimationReady(false)
  }, [autoMedia.selected])
  useEffect(() => {
    setAnimationReady(false)
    setPlaybackFailed(false)
    setSeeking(false)
    seekPreviewRef.current = null
  }, [activeIdentity, isActive])
  useEffect(() => {
    if (swiper && !swiper.destroyed && swiper.activeIndex !== currentImageIndex) swiper.slideTo(currentImageIndex, 0)
  }, [currentImageIndex, swiper])
  const observeReading = reading?.observe
  const clearReadingSurface = reading?.clearSurface
  const observationEpoch = reading?.observationEpoch
  const videoReading = useVideoReading(
    `${reading?.ownerUserId}:${currentMedia.id}:${currentMedia.updatedAt}`,
    isActive && !interactionLocked && !chapterPanelOpen
  )
  const playback = videoReading.playback
  const isReadingVideo = currentMedia.mediaType === MediaType.VIDEO
  useEffect(() => {
    if (!observeReading || !clearReadingSurface) return
    const surfaceId = 'immersive-viewer'
    observeReading(surfaceId, {
      mediaId: currentMedia.id,
      ready:
        activeMediaStatus === 'ready' &&
        loadedMediaIdsRef.current.has(currentMedia.id) &&
        (!isReadingVideo || playback !== null),
      visible: isActive && !interactionLocked && !chapterPanelOpen,
      automatic: autoMedia.running,
      priority: 50,
      ...(isReadingVideo && playback ? { playback } : {})
    })
  }, [
    autoMedia.running,
    playback,
    isReadingVideo,
    activeMediaStatus,
    chapterPanelOpen,
    clearReadingSurface,
    currentMedia.id,
    interactionLocked,
    isActive,
    observationEpoch,
    observeReading
  ])
  useEffect(() => () => clearReadingSurface?.('immersive-viewer'), [clearReadingSurface])

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
    setPlaybackFailed(false)
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
      useViewerStore.getState().pauseAutoBrowse('user')
      video.pause()
      setVideoState(readVideoState(video))
      return
    }

    void video.play().catch(() => {
      if (!video.muted) {
        video.muted = true
        onAudioPreferenceChange({ ...audioPreference, muted: true })
        void video.play().catch(() => {
          setPlaybackFailed(true)
          toast.error('视频暂时无法播放')
        })
        return
      }
      setPlaybackFailed(true)
      toast.error('视频暂时无法播放')
    })
  }, [audioPreference, onAudioPreferenceChange])

  const handleSeek = useCallback(
    (seconds: number) => {
      const video = activeVideoRef.current
      if (!video) return

      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null
      const nextTime = duration ? Math.min(Math.max(seconds, 0), duration) : Math.max(seconds, 0)
      if (!duration || nextTime < duration) {
        autoMedia.cancelCompletion()
        onCancelArtworkComplete?.()
      }
      video.currentTime = nextTime
      setVideoState((current) => ({ ...current, currentTime: nextTime }))
    },
    [autoMedia.cancelCompletion, onCancelArtworkComplete]
  )

  const handleSeekPreviewStart = useCallback(() => {
    if (seekPreviewRef.current) return
    const video = activeVideoRef.current
    if (!video) return
    const wasPlaying = !video.paused && !video.ended
    seekPreviewRef.current = { wasPlaying }
    setSeeking(true)
    blockedRef.current = true
    if (wasPlaying) video.pause()
  }, [])

  const handleSeekCommit = useCallback(
    (seconds: number) => {
      const preview = seekPreviewRef.current
      seekPreviewRef.current = null
      setSeeking(false)
      handleSeek(seconds)
      const video = activeVideoRef.current
      if (preview?.wasPlaying && video) {
        if (Number.isFinite(video.duration) && video.duration > 0 && seconds >= video.duration) autoMedia.complete()
        else void video.play().catch(() => setPlaybackFailed(true))
      }
    },
    [handleSeek, autoMedia.complete]
  )

  const handleSeekPreviewCancel = useCallback(() => {
    const preview = seekPreviewRef.current
    seekPreviewRef.current = null
    setSeeking(false)
    if (
      preview?.wasPlaying &&
      seekResumeAllowedRef.current &&
      document.visibilityState !== 'hidden' &&
      useViewerStore.getState().autoBrowseStatus !== 'paused'
    ) {
      void activeVideoRef.current?.play().catch(() => setPlaybackFailed(true))
    }
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
    if (!isActive || interactionLocked || chapterPanelOpen) return

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
      onSeek: handleSeek,
      onTogglePlayback: handleTogglePlayback,
      onOpenActions: () => overlayApiRef.current?.openActions(),
      onToggleChrome,
      onFeedback: setGestureFeedback
    })
    gestureEngineRef.current = engine
    window.addEventListener('blur', engine.pointerCancel)
    return () => {
      window.removeEventListener('blur', engine.pointerCancel)
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
    interactionLocked,
    chapterPanelOpen,
    longPressRate,
    onToggleChrome,
    seekStepSeconds
  ])

  useEffect(() => {
    if (!isActive || currentMedia.mediaType !== MediaType.VIDEO) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (
        event.code !== 'Space' ||
        chapterPanelOpen ||
        interactionLocked ||
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey
      ) {
        return
      }
      const target = event.target instanceof HTMLElement ? event.target : null
      if (target?.closest('a, button, input, select, textarea, [contenteditable], [role="slider"], [role="dialog"]')) {
        return
      }
      event.preventDefault()
      handleTogglePlayback()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chapterPanelOpen, interactionLocked, currentMedia.mediaType, handleTogglePlayback, isActive])

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
      playbackRate,
      videoZoom: isActiveCurrent ? videoZoom : 1,
      sourceSwitchDisabled: interactionLocked || chapterPanelOpen,
      shouldLoad,
      preloadMode,
      priority: isActiveCurrent && media.mediaType === MediaType.IMAGE,
      isActiveMedia: isActiveCurrent,
      autoPlayback:
        isActiveCurrent && autoMedia.selected
          ? autoStatus === 'running' && !interactionLocked && !chapterPanelOpen
            ? ('running' as const)
            : ('paused' as const)
          : undefined,
      autoRestartKey: autoRestart?.mediaId === media.id ? autoRestart.revision : 0,
      autoRestartPending: autoRestart?.mediaId === media.id && !autoRestart.consumed,
      onMediaComplete: isActiveCurrent ? autoMedia.complete : undefined,
      onAutoPause: () => useViewerStore.getState().pauseAutoBrowse('user'),
      onPlaybackError: () => {
        if (isActiveCurrent && mediaIdentityRef.current === activeIdentity) setPlaybackFailed(true)
      },
      onAnimationReady: () => {
        if (isActiveCurrent && mediaIdentityRef.current === activeIdentity) setAnimationReady(true)
      },
      onAnimationBuffering: () => {
        if (isActiveCurrent && mediaIdentityRef.current === activeIdentity) setAnimationReady(false)
      },
      onMediaReady: () => handleMediaReady(media.id),
      onMediaError: () => handleMediaError(media.id),
      onVideoElementChange: isCurrent ? handleVideoElementChange : undefined,
      onVideoStateChange: isCurrent ? setVideoState : undefined,
      onReadingProgress: isActiveCurrent ? videoReading.onProgress : undefined,
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
        chromeHidden={isChromeHidden}
        interactionLocked={interactionLocked || chapterPanelOpen}
        media={currentMedia}
        state={videoState}
        playbackRate={playbackRate}
        onPlaybackRateChange={onPlaybackRateChange}
        zoom={videoZoom}
        onZoomChange={setVideoZoom}
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
      currentMediaId={image.images.length > 0 ? currentMedia.id : null}
      mediaControls={mediaControls}
      onInteractionApiChange={(api) => {
        overlayApiRef.current = api
      }}
      onPanelOpenChange={onOverlayPanelOpenChange}
    />
  )
  const autoError =
    isActive && autoMedia.selected && (activeMediaStatus === 'error' || playbackFailed) ? (
      <div
        role="status"
        data-viewer-control
        className="absolute inset-x-4 top-20 z-40 flex flex-col gap-2 rounded-lg bg-background p-3 text-foreground shadow-lg"
      >
        <span className="text-sm">媒体无法播放，自动浏览已暂停。</span>
        {playbackFailed && (
          <Button variant="outline" className="min-h-11" onClick={handleRetry}>
            重试媒体
          </Button>
        )}
        <Button
          variant="outline"
          className="min-h-11"
          onClick={() => {
            setPlaybackFailed(false)
            setActiveMediaStatus('pending')
            useViewerStore.getState().runAutoBrowse()
            advance()
          }}
        >
          跳过并继续
        </Button>
      </div>
    ) : null

  if (!hasMultipleImages) {
    return (
      <div
        className="relative h-full w-full"
        onPointerDownCapture={(event) => {
          if (event.target instanceof Element && event.target.closest(VIEWER_CONTROL_SELECTOR)) {
            gestureEngineRef.current?.pointerCancel()
          }
        }}
      >
        <SingleImage
          media={currentMedia}
          chromeHidden={isChromeHidden}
          audioPreference={audioPreference}
          onError={onError}
          retryKey={retryKey}
          onRetry={handleRetry}
          {...buildMediaProps(currentMedia, 0)}
        />
        {overlay}
        {autoError}
        <ViewerGestureFeedback feedback={gestureFeedback} buffering={showBuffering} />
      </div>
    )
  }

  return (
    <div
      className="relative h-full w-full"
      onPointerDownCapture={(event) => {
        if (event.target instanceof Element && event.target.closest(VIEWER_CONTROL_SELECTOR)) {
          gestureEngineRef.current?.pointerCancel()
        }
      }}
    >
      <Swiper
        onSwiper={setSwiper}
        modules={[Keyboard]}
        direction="horizontal"
        slidesPerView={1}
        lazyPreloadPrevNext={0}
        spaceBetween={0}
        initialSlide={currentImageIndex}
        allowTouchMove={!interactionLocked && !chapterPanelOpen}
        // Match the vertical Swiper: focused videos without native controls must still swipe.
        focusableElements="input, select, option, textarea, button, video[controls], label"
        noSwipingSelector=".swiper-no-swiping, [data-viewer-control]"
        keyboard={{
          enabled: isActive && !interactionLocked && !chapterPanelOpen,
          onlyInViewport: true
        }}
        onSlideChange={handleSlideChange}
        touchRatio={1}
        touchAngle={45}
        grabCursor
        resistance
        resistanceRatio={0.85}
        speed={300}
        onBeforeTransitionStart={() => setHorizontalTransition(true)}
        onTransitionEnd={() => setHorizontalTransition(false)}
        nested
        className="relative z-10 h-full w-full !overflow-clip"
      >
        {mediaItems.map((media, index) => (
          <SwiperSlide key={media.key} inert={!isActive || index !== currentImageIndex}>
            <SingleImage
              media={media}
              chromeHidden={isChromeHidden}
              audioPreference={audioPreference}
              onError={index === currentImageIndex ? onError : undefined}
              retryKey={retryKey}
              onRetry={handleRetry}
              {...buildMediaProps(media, index)}
            />
          </SwiperSlide>
        ))}
      </Swiper>

      {isActive && (!isChromeHidden || currentMedia.mediaType !== MediaType.VIDEO) && (
        <ViewerImageProgress
          hidden={isChromeHidden}
          index={currentImageIndex}
          count={mediaItems.length}
          disabled={interactionLocked || chapterPanelOpen}
          onSeekingChange={setSeeking}
          onCommit={(index) => {
            if (!swiper || swiper.destroyed) return
            autoMedia.cancelCompletion()
            onCancelArtworkComplete?.()
            swiper.slideTo(index)
          }}
        />
      )}

      {overlay}
      {autoError}
      <ViewerGestureFeedback feedback={gestureFeedback} buffering={showBuffering} />
    </div>
  )
}
