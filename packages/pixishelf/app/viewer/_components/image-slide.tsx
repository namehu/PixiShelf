'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
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
import ViewerVideoControls, {
  type ViewerAudioPreference,
  type ViewerVideoState
} from './viewer-video-controls'

// 导入 Swiper 样式
import 'swiper/css'
import 'swiper/css/navigation'
import 'swiper/css/pagination'

interface ImageSlideProps extends Pick<SingleImageProps, 'onError'> {
  image: RandomImageItem
  isActive: boolean
  isPreloading: boolean
  audioPreference: ViewerAudioPreference
  onAudioPreferenceChange: (preference: ViewerAudioPreference) => void
  chapterPanelOpen: boolean
  onChapterPanelOpenChange: (open: boolean) => void
}

interface SingleImageProps {
  media: ViewerMediaItem
  onError?: (() => void) | undefined
  retryKey: number
  priority?: boolean
  isPreloading?: boolean
  shouldLoad?: boolean
  isActiveMedia?: boolean
  audioPreference: ViewerAudioPreference
  onRetry: () => void
  onToggleChrome?: () => void
  onVideoElementChange?: (element: HTMLVideoElement | null) => void
  onVideoStateChange?: (state: ViewerVideoState) => void
  onAutoplayMutedFallback?: () => void
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
  isPreloading = false,
  shouldLoad = true,
  isActiveMedia = false,
  audioPreference,
  onToggleChrome,
  onVideoElementChange,
  onVideoStateChange,
  onAutoplayMutedFallback
}: SingleImageProps) {
  const [imageError, setImageError] = useState(false)
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const autoplayMutedFallbackRef = useRef(onAutoplayMutedFallback)

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
  }

  useLayoutEffect(() => {
    setImageError(false)
  }, [media.url, retryKey])

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
  }, [isActiveMedia, media.mediaType, media.url, publishVideoState])

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
            <p className="mb-2 text-sm opacity-60">
              {media.mediaType === MediaType.IMAGE ? '图片' : '视频'}加载失败
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

  return (
    <div
      className="relative flex h-full w-full items-center justify-center"
      onClick={media.mediaType === MediaType.VIDEO ? onToggleChrome : undefined}
    >
      {media.mediaType === MediaType.IMAGE ? (
        <Image
          key={`${media.key}-${retryKey}`}
          src={media.url}
          width={window.outerWidth}
          height={window.outerHeight}
          alt={media.key || 'Artwork media'}
          className="h-full w-full object-contain"
          loading={priority || isPreloading ? 'eager' : 'lazy'}
          priority={priority}
          quality={100}
          onError={handleImageError}
        />
      ) : (
        <video
          key={`${media.key}-${retryKey}`}
          ref={setVideoElement}
          src={media.url}
          autoPlay={isActiveMedia}
          controls={false}
          loop
          muted={audioPreference.muted}
          playsInline
          tabIndex={-1}
          className="h-full w-full object-contain"
          preload={priority || isPreloading ? 'auto' : 'none'}
          onLoadedMetadata={(event) => publishVideoState(event.currentTarget)}
          onDurationChange={(event) => publishVideoState(event.currentTarget)}
          onTimeUpdate={(event) => publishVideoState(event.currentTarget)}
          onPlay={(event) => publishVideoState(event.currentTarget)}
          onPlaying={(event) => publishVideoState(event.currentTarget)}
          onPause={(event) => publishVideoState(event.currentTarget)}
          onWaiting={(event) => publishVideoState(event.currentTarget, true)}
          onError={handleImageError}
        />
      )}
    </div>
  )
}

/**
 * 图片滑块组件，支持作品间纵向切换及作品内部的横向媒体切换。
 */
export default function ImageSlide({
  isActive,
  isPreloading,
  image,
  onError,
  audioPreference,
  onAudioPreferenceChange,
  chapterPanelOpen,
  onChapterPanelOpenChange
}: ImageSlideProps) {
  const [retryKey, setRetryKey] = useState(0)
  const [videoState, setVideoState] = useState<ViewerVideoState>(INITIAL_VIDEO_STATE)
  const activeVideoRef = useRef<HTMLVideoElement | null>(null)

  const [horizontalIndexes, setHorizontalIndex, isChromeHidden, setChromeHidden] = useViewerStore(
    useShallow((state) => [
      state.horizontalIndexes,
      state.setHorizontalIndex,
      state.isChromeHidden,
      state.setChromeHidden
    ])
  )

  const fallbackMedia: ViewerMediaItem = {
    key: image.key,
    url: image.imageUrl,
    mediaType: image.mediaType,
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
  }, [currentMedia.duration, currentMedia.key, currentMedia.mediaType])

  const handleRetry = () => {
    setRetryKey((previousKey) => previousKey + 1)
  }

  const handleToggleChrome = useCallback(() => {
    if (!isActive) return

    const nextHidden = !isChromeHidden
    setChromeHidden(nextHidden)
    if (nextHidden) toast.success('已清屏播放')
  }, [isActive, isChromeHidden, setChromeHidden])

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
        onToggleMuted={handleToggleMuted}
        onVolumeChange={handleVolumeChange}
        chapterPanelOpen={chapterPanelOpen}
        onChapterPanelOpenChange={onChapterPanelOpenChange}
      />
    ) : null

  if (!hasMultipleImages) {
    return (
      <>
        <SingleImage
          media={currentMedia}
          priority={isActive}
          isPreloading={isPreloading}
          isActiveMedia={isActive && currentMedia.mediaType === MediaType.VIDEO}
          audioPreference={audioPreference}
          onError={onError}
          retryKey={retryKey}
          onRetry={handleRetry}
          onToggleChrome={handleToggleChrome}
          onVideoElementChange={handleVideoElementChange}
          onVideoStateChange={setVideoState}
          onAutoplayMutedFallback={handleAutoplayMutedFallback}
        />
        <ImageOverlay isActive={isActive} image={image} mediaControls={mediaControls} />
      </>
    )
  }

  return (
    <>
      <Swiper
        modules={[Navigation, Keyboard]}
        direction="horizontal"
        slidesPerView={1}
        lazyPreloadPrevNext={1}
        spaceBetween={0}
        initialSlide={currentImageIndex}
        keyboard={{ enabled: true, onlyInViewport: true }}
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
        {mediaItems.map((media, index) => {
          const isCurrentImage = index === currentImageIndex
          const shouldLoad = isActive ? Math.abs(index - currentImageIndex) <= 1 : isCurrentImage
          const isActiveMedia = isActive && isCurrentImage && media.mediaType === MediaType.VIDEO

          return (
            <SwiperSlide key={media.key}>
              <SingleImage
                media={media}
                shouldLoad={shouldLoad}
                isPreloading={shouldLoad}
                priority={isActive && isCurrentImage}
                isActiveMedia={isActiveMedia}
                audioPreference={audioPreference}
                onError={onError}
                retryKey={retryKey}
                onRetry={handleRetry}
                onToggleChrome={isCurrentImage ? handleToggleChrome : undefined}
                onVideoElementChange={isCurrentImage ? handleVideoElementChange : undefined}
                onVideoStateChange={isCurrentImage ? setVideoState : undefined}
                onAutoplayMutedFallback={isCurrentImage ? handleAutoplayMutedFallback : undefined}
              />
            </SwiperSlide>
          )
        })}
      </Swiper>

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

      <ImageOverlay isActive={isActive} image={image} mediaControls={mediaControls} />

      {!isChromeHidden && (
        <div className="absolute right-4 top-4 z-30 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
          {currentImageIndex + 1} / {mediaItems.length}
        </div>
      )}
    </>
  )
}
