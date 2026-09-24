'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import AnimatedWebpPlayer from '@/components/players/animated-webp-player'
import {
  AnimationPlaybackCapsule,
  animationPlaybackLabel,
  formatAnimationFileSize
} from '@/components/players/animation-playback-capsule'
import {
  VerticalMediaPreviewCore,
  type VerticalMediaPreviewController
} from '@/components/source-preview/vertical-media-preview-core'
import { isApngFile, isGifFile, isWebpFile } from '@/lib/media'
import { isConfirmedStaticWebp } from '@/lib/media-animation'
import { withMediaVersion } from '@/lib/media-url'
import { canPreloadAdaptedImage, readMediaPreloadEnvironment, type MediaPreloadEnvironment } from '@/lib/media-preload'
import { cn } from '@/lib/utils'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { AutoBrowseControls } from './auto-browse-controls'
import { useArtworkAnimation } from './use-artwork-animation'
import { useArtworkSlideshow } from './use-artwork-slideshow'

const ADAPTIVE_PREVIEW_HISTORY_KEY = '__pixishelf_adaptive_media_preview__'
export type AdaptivePreloadEnvironment = MediaPreloadEnvironment

interface AdaptiveMediaPreviewProps {
  images: ArtworkImageResponseDto[]
  initialIndex: number
  initialPreviewSrc?: string
  open: boolean
  onClose: (finalIndex: number) => void
}

function isAnimatedMedia(media: ArtworkImageResponseDto) {
  if (isConfirmedStaticWebp(media)) return false
  return Boolean(media.isAnimated) || isApngFile(media.path) || isGifFile(media.path) || isWebpFile(media.path)
}

function isPlayableAnimatedWebp(media: ArtworkImageResponseDto) {
  return isWebpFile(media.path) && media.isAnimated === true
}

export function canPreloadAdaptiveNeighbor(media: ArtworkImageResponseDto, environment: AdaptivePreloadEnvironment) {
  // WebP/GIF 的邻近预加载只请求静态 JPG 海报，避免提前下载完整动图。
  const staticPoster = isWebpFile(media.path) || isGifFile(media.path)
  return canPreloadAdaptedImage({ ...media, isAnimated: !staticPoster && isAnimatedMedia(media) }, environment)
}

function clampIndex(index: number, length: number) {
  return Math.min(Math.max(index, 0), Math.max(0, length - 1))
}

function previewResourceKey(media: ArtworkImageResponseDto | undefined) {
  return media ? `${media.id}:${media.path}:${media.updatedAt}` : ''
}

export default function AdaptiveMediaPreview({
  images,
  initialIndex,
  initialPreviewSrc,
  open,
  onClose
}: AdaptiveMediaPreviewProps) {
  const safeInitialIndex = clampIndex(initialIndex, images.length)
  const [currentIndex, setCurrentIndex] = useState(safeInitialIndex)
  const [zoomScale, setZoomScale] = useState(1)
  const animation = useArtworkAnimation(images[currentIndex]?.id, 'slideshow', previewResourceKey(images[currentIndex]))
  const isWebpPlaying = animation.playing
  const [decodedIndexes, setDecodedIndexes] = useState<Set<string>>(() => new Set())
  const [errorIndexes, setErrorIndexes] = useState<Set<string>>(() => new Set())
  const [retryCounts, setRetryCounts] = useState<Record<number, number>>({})
  const [transitioning, setTransitioning] = useState(false)
  const [webpProgress, setWebpProgress] = useState<{ key: string; percent: number | null } | null>(null)
  const autoSlideshowSelected = useArtworkAutoBrowseStore((state) => state.mode === 'slideshow')
  const loadGeneration = useRef(0)
  const progressGeneration = useRef(0)
  const retryGeneration = useRef<Record<number, number>>({})
  const [preloadEnvironment, setPreloadEnvironment] = useState<AdaptivePreloadEnvironment>({
    isMobile: true,
    saveData: false
  })
  const swiperRef = useRef<VerticalMediaPreviewController | null>(null)

  useEffect(() => {
    if (!open || typeof window === 'undefined') return

    const nextIndex = clampIndex(initialIndex, images.length)
    setCurrentIndex(nextIndex)
    setZoomScale(1)
    animation.stopManual()
    setDecodedIndexes(new Set())
    setErrorIndexes(new Set())
    loadGeneration.current += 1
    progressGeneration.current += 1
    setPreloadEnvironment(readMediaPreloadEnvironment())
    return () => {
      loadGeneration.current += 1
      progressGeneration.current += 1
    }
  }, [images.length, initialIndex, open])

  const activeMedia = images[currentIndex]
  const activeProgress = webpProgress?.key === previewResourceKey(activeMedia) ? webpProgress.percent : null
  const activePlayableWebp = useMemo(() => (activeMedia ? isPlayableAnimatedWebp(activeMedia) : false), [activeMedia])
  const eagerNeighborIndexes = useMemo(() => {
    const indexes = new Set<number>()
    for (const index of [currentIndex - 1, currentIndex + 1, currentIndex + 2]) {
      const media = images[index]
      if (media && canPreloadAdaptiveNeighbor(media, preloadEnvironment)) indexes.add(index)
    }
    return indexes
  }, [currentIndex, images, preloadEnvironment])

  const markImageDecoded = useCallback(
    (index: number) => {
      const key = previewResourceKey(images[index])
      setDecodedIndexes((current) => {
        if (current.has(key)) return current
        const next = new Set(current)
        next.add(key)
        return next
      })
    },
    [images]
  )

  const handleImageLoad = useCallback(
    (index: number, image?: HTMLImageElement) => {
      const generation = loadGeneration.current
      const attempt = retryGeneration.current[index] ?? 0
      if (!image?.decode) {
        markImageDecoded(index)
        return
      }

      void image.decode().then(
        () => {
          if (loadGeneration.current === generation && (retryGeneration.current[index] ?? 0) === attempt) {
            markImageDecoded(index)
          }
        },
        () => {
          if (loadGeneration.current !== generation || (retryGeneration.current[index] ?? 0) !== attempt) return
          if (image.naturalWidth > 0) markImageDecoded(index)
          else setErrorIndexes((current) => new Set(current).add(previewResourceKey(images[index])))
        }
      )
    },
    [images, markImageDecoded]
  )

  const handleSlideChange = useCallback(
    (index: number) => {
      const nextIndex = clampIndex(index, images.length)
      progressGeneration.current += 1
      setWebpProgress(null)
      setCurrentIndex(nextIndex)
      const media = images[nextIndex]
      if (media) useArtworkAutoBrowseStore.getState().setCurrentMedia(media.id)
      setZoomScale(1)
      animation.stopManual()
    },
    [images]
  )

  const handleZoomChange = useCallback((scale: number) => {
    const isZoomed = scale > 1.01
    if (isZoomed) useArtworkAutoBrowseStore.getState().pause('zoom')
    else if (useArtworkAutoBrowseStore.getState().reason === 'zoom') {
      useArtworkAutoBrowseStore.getState().clearPauseReason()
    }
    setZoomScale(scale)
  }, [])

  const nextSlide = useCallback(
    () => swiperRef.current?.slideNext(window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : undefined),
    []
  )
  const firstSlide = useCallback(() => swiperRef.current?.slideTo(0, 0), [])
  useArtworkSlideshow({
    index: currentIndex,
    count: images.length,
    ready: decodedIndexes.has(previewResourceKey(activeMedia)),
    error: errorIndexes.has(previewResourceKey(activeMedia)),
    blocked: zoomScale > 1.01,
    mediaId: activeMedia?.id,
    animated: activePlayableWebp,
    transitioning,
    enabled: open,
    onNext: nextSlide,
    onFirst: firstSlide
  })
  const retryCurrent = () => {
    useArtworkAutoBrowseStore.getState().pause()
    useArtworkAutoBrowseStore.getState().clearPauseReason()
    retryGeneration.current[currentIndex] = (retryGeneration.current[currentIndex] ?? 0) + 1
    setErrorIndexes((indexes) => {
      const next = new Set(indexes)
      next.delete(previewResourceKey(activeMedia))
      return next
    })
    setDecodedIndexes((indexes) => {
      const next = new Set(indexes)
      next.delete(previewResourceKey(activeMedia))
      return next
    })
    setRetryCounts((counts) => ({ ...counts, [currentIndex]: (counts[currentIndex] ?? 0) + 1 }))
  }

  if (!images.length) return null

  return (
    <VerticalMediaPreviewCore
      items={images}
      itemKey={(media, index) => media.id || index}
      initialIndex={safeInitialIndex}
      transitionEffect="fade"
      open={open}
      onClose={(finalIndex) => {
        animation.stopManual()
        onClose(finalIndex)
      }}
      historyKey={ADAPTIVE_PREVIEW_HISTORY_KEY}
      title="适配尺寸媒体预览"
      description="上下滑动切换媒体，双指或双击缩放图片；WebP 动图可通过底部按钮播放或暂停。"
      closeLabel="关闭适配尺寸预览"
      testId="adaptive-media-preview-swiper"
      onControllerChange={(controller) => {
        swiperRef.current = controller
      }}
      onActiveIndexChange={handleSlideChange}
      onZoomChange={handleZoomChange}
      onManualNavigation={() => useArtworkAutoBrowseStore.getState().pause()}
      onTouchStart={() => useArtworkAutoBrowseStore.getState().pause()}
      onTransitioningChange={setTransitioning}
      onBeforeClose={() => useArtworkAutoBrowseStore.getState().pause('overlay')}
      renderSlide={(media, { index }) => {
        const currentProgressGeneration = progressGeneration.current
        const animated = isAnimatedMedia(media)
        const playableAnimatedWebp = isPlayableAnimatedWebp(media)
        const eager = index === currentIndex || eagerNeighborIndexes.has(index)
        const priority = index === safeInitialIndex
        const decoded = decodedIndexes.has(previewResourceKey(media))
        const showInitialPreview = index === safeInitialIndex && Boolean(initialPreviewSrc)

        return (
          <div className="swiper-zoom-container relative h-full w-full px-0 py-16 sm:px-12 sm:py-20">
            {showInitialPreview && initialPreviewSrc && (
              <Image
                src={initialPreviewSrc}
                alt=""
                aria-hidden="true"
                data-testid="adaptive-preview-placeholder"
                data-ready={decoded ? 'true' : 'false'}
                fill
                unoptimized
                sizes="100vw"
                draggable={false}
                className={cn(
                  'pointer-events-none absolute inset-0 select-none object-contain motion-safe:transition-opacity motion-safe:duration-(--motion-base)',
                  decoded ? 'opacity-0' : 'opacity-100'
                )}
              />
            )}
            {playableAnimatedWebp ? (
              <AnimatedWebpPlayer
                key={`${media.path}:${media.updatedAt}:${retryCounts[index] ?? 0}`}
                src={media.path}
                alt={`作品 WEBP 动图 ${index + 1}`}
                size={media.size}
                animationMetadata={media.animationMetadata}
                isAnimated
                updatedAt={media.updatedAt}
                fillContainer
                posterLoading={eager ? 'eager' : 'lazy'}
                controlMode="external"
                onPlaybackProgress={(percent) => {
                  if (progressGeneration.current !== currentProgressGeneration) return
                  setWebpProgress({ key: previewResourceKey(media), percent })
                }}
                {...(index === currentIndex ? animation : { playing: false })}
                onPosterLoad={(image) => handleImageLoad(index, image)}
                onPosterError={() => setErrorIndexes((current) => new Set(current).add(previewResourceKey(media)))}
                className={cn(
                  'swiper-zoom-target select-none bg-transparent motion-safe:transition-opacity motion-safe:duration-(--motion-base)',
                  showInitialPreview && !decoded && 'opacity-0'
                )}
              />
            ) : (
              <Image
                key={`${media.path}:${media.updatedAt}:${retryCounts[index] ?? 0}`}
                src={withMediaVersion(media.path, media.updatedAt)}
                alt={`作品媒体 ${index + 1}`}
                fill
                sizes="100vw"
                quality={90}
                priority={priority}
                loading={priority ? undefined : eager ? 'eager' : 'lazy'}
                draggable={false}
                className={cn(
                  'swiper-zoom-target select-none object-contain motion-safe:transition-opacity motion-safe:duration-(--motion-base)',
                  showInitialPreview && !decoded && 'opacity-0'
                )}
                onLoad={(event) => handleImageLoad(index, event.currentTarget)}
                onError={() => setErrorIndexes((current) => new Set(current).add(previewResourceKey(media)))}
              />
            )}
            {animated && !playableAnimatedWebp && !autoSlideshowSelected && (
              <span className="pointer-events-none absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 text-xs text-white/85 backdrop-blur-md">
                动图静态预览
              </span>
            )}
          </div>
        )
      }}
      bottomChrome={({ portalContainer: container }) => (
        <div className="pointer-events-none absolute inset-x-4 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 h-12">
          {activePlayableWebp && (
            <button
              type="button"
              className={cn(
                'pointer-events-auto absolute right-0 flex min-h-11 min-w-11 items-center justify-center rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-ring',
                images.length > 1 ? 'bottom-[calc(100%+0.5rem)] sm:bottom-0' : 'bottom-0'
              )}
              aria-label={animationPlaybackLabel(isWebpPlaying, animation.playOnce, 'WEBP', activeProgress)}
              data-auto-browse-controls
              aria-pressed={isWebpPlaying}
              onClick={() => {
                animation.onPlayingChange(!isWebpPlaying)
              }}
            >
              <AnimationPlaybackCapsule
                playing={isWebpPlaying}
                playOnce={animation.playOnce}
                label="WEBP"
                fileSize={formatAnimationFileSize(activeMedia?.size)}
                progressPercent={activeProgress}
              />
            </button>
          )}
          {images.length > 1 && (
            <div className="pointer-events-none absolute bottom-0 left-1/2 max-w-full -translate-x-1/2">
              <AutoBrowseControls
                mode="slideshow"
                current={currentIndex + 1}
                total={images.length}
                navigation={
                  <span className="px-2 text-sm tabular-nums">
                    {currentIndex + 1}/{images.length}
                  </span>
                }
                blocked={zoomScale > 1.01}
                container={container}
                onRestart={() => {
                  firstSlide()
                  useArtworkAutoBrowseStore.getState().start('slideshow')
                }}
                onRetry={retryCurrent}
                onSkip={() => {
                  useArtworkAutoBrowseStore.getState().pause()
                  useArtworkAutoBrowseStore.getState().clearPauseReason()
                  if (activeMedia) useArtworkAutoBrowseStore.getState().skip(activeMedia.id)
                }}
              />
            </div>
          )}
        </div>
      )}
    />
  )
}
