'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { PauseIcon, PlayIcon } from 'lucide-react'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import AnimatedWebpPlayer from '@/components/players/animated-webp-player'
import {
  VerticalMediaPreviewCore,
  type VerticalMediaPreviewController
} from '@/components/source-preview/vertical-media-preview-core'
import { Button } from '@/components/ui/button'
import { isApngFile, isGifFile, isWebpFile } from '@/lib/media'
import { isConfirmedStaticWebp } from '@/lib/media-animation'
import { withMediaVersion } from '@/lib/media-url'
import { canPreloadAdaptedImage, readMediaPreloadEnvironment, type MediaPreloadEnvironment } from '@/lib/media-preload'
import { cn } from '@/lib/utils'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { AutoBrowseControls } from './auto-browse-controls'
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
  // WebP/GIF preview requests resolve to static JPG posters, never animation originals.
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
  const [isWebpPlaying, setIsWebpPlaying] = useState(false)
  const [decodedIndexes, setDecodedIndexes] = useState<Set<string>>(() => new Set())
  const [errorIndexes, setErrorIndexes] = useState<Set<string>>(() => new Set())
  const [retryCounts, setRetryCounts] = useState<Record<number, number>>({})
  const [transitioning, setTransitioning] = useState(false)
  const autoSlideshowSelected = useArtworkAutoBrowseStore((state) => state.mode === 'slideshow')
  const autoControlsCollapsed = useArtworkAutoBrowseStore(
    (state) => state.mode === 'slideshow' && state.controlsCollapsed
  )
  const loadGeneration = useRef(0)
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
    setIsWebpPlaying(false)
    setDecodedIndexes(new Set())
    setErrorIndexes(new Set())
    loadGeneration.current += 1
    setPreloadEnvironment(readMediaPreloadEnvironment())
    return () => {
      loadGeneration.current += 1
    }
  }, [images.length, initialIndex, open])

  const activeMedia = images[currentIndex]
  const activeAnimated = useMemo(() => (activeMedia ? isAnimatedMedia(activeMedia) : false), [activeMedia])
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
      setCurrentIndex(nextIndex)
      const media = images[nextIndex]
      if (media) useArtworkAutoBrowseStore.getState().setCurrentMedia(media.id)
      setZoomScale(1)
      setIsWebpPlaying(false)
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
    blocked: zoomScale > 1.01 || isWebpPlaying,
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
      open={open}
      onClose={(finalIndex) => {
        setIsWebpPlaying(false)
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
                isAnimated
                updatedAt={media.updatedAt}
                fillContainer
                posterLoading={eager ? 'eager' : 'lazy'}
                controlMode="external"
                playing={index === currentIndex && isWebpPlaying}
                onPlayingChange={(playing) => {
                  if (index === currentIndex) setIsWebpPlaying(playing)
                }}
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
        <div className="pointer-events-none absolute inset-x-4 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 flex flex-col items-end gap-2">
          {activePlayableWebp && !autoControlsCollapsed && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="pointer-events-auto rounded-full shadow-lg"
              aria-label={`${isWebpPlaying ? '暂停' : '播放'} WEBP 动图`}
              aria-pressed={isWebpPlaying}
              onClick={() => {
                useArtworkAutoBrowseStore.getState().pause()
                setIsWebpPlaying((playing) => !playing)
              }}
            >
              {isWebpPlaying ? <PauseIcon data-icon="inline-start" /> : <PlayIcon data-icon="inline-start" />}
              {isWebpPlaying ? '暂停 WEBP' : '播放 WEBP'}
            </Button>
          )}
          {images.length > 1 && (
            <AutoBrowseControls
              mode="slideshow"
              current={currentIndex + 1}
              total={images.length}
              navigation={
                <span className="px-2 text-sm tabular-nums">
                  {currentIndex + 1}/{images.length}
                </span>
              }
              blocked={zoomScale > 1.01 || isWebpPlaying}
              container={container}
              onRestart={() => {
                firstSlide()
                useArtworkAutoBrowseStore.getState().start('slideshow')
              }}
              onRetry={retryCurrent}
              onSkip={() => {
                useArtworkAutoBrowseStore.getState().pause()
                useArtworkAutoBrowseStore.getState().clearPauseReason()
                if (currentIndex === images.length - 1) useArtworkAutoBrowseStore.getState().end()
                else nextSlide()
              }}
            />
          )}
          {!autoSlideshowSelected && (
            <span className="self-center rounded-full bg-black/35 px-3 py-1 text-xs text-white/75 backdrop-blur-md">
              {zoomScale > 1.01
                ? `${zoomScale.toFixed(1)}× · 拖动查看，缩小后切换`
                : activeAnimated && !activePlayableWebp
                  ? '静态适配预览 · 长按原媒体可查看原文件'
                  : '上下切换 · 双指或双击缩放'}
            </span>
          )}
        </div>
      )}
    />
  )
}
