'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { MediaDetailsPlaceholder, useReaderMediaWindow } from '@/lib/reading/artwork-reader-provider'
import { Button } from '@/components/ui/button'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { WebpDiagnosticsPanel, type WebpDiagnosticResult } from '@/components/players/webp-diagnostics-panel'
import { combinationApiResource } from '@/utils/combination-static'
import { WebpPreviewSession } from '@/components/players/webp-preview-session'
import AnimatedWebpPlayer from '@/components/players/animated-webp-player'
import {
  AnimationPlaybackCapsule,
  animationPlaybackLabel,
  formatAnimationFileSize
} from '@/components/players/animation-playback-capsule'
import {
  VerticalMediaPreviewCore,
  type VerticalMediaPreviewController
} from '@/components/media-preview/vertical-media-preview-core'
import { isApngFile, isGifFile, isWebpFile } from '@/lib/media'
import { isConfirmedStaticWebp } from '@/lib/media-animation'
import { withMediaVersion } from '@/lib/media-url'
import { canPreloadAdaptedImage, readMediaPreloadEnvironment, type MediaPreloadEnvironment } from '@/lib/media-preload'
import { cn } from '@/lib/utils'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { AutoBrowseControls } from './auto-browse-controls'
import { useArtworkAnimation } from './use-artwork-animation'
import { useArtworkSlideshow } from './use-artwork-slideshow'
import { readingMediaPosition } from './reading-media-status'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import { useMediaMark, usePrefetchMediaMarks } from '@/hooks/use-media-mark'
import { MediaMarkActions } from '@/components/media-mark/media-mark-actions'

const ADAPTIVE_PREVIEW_HISTORY_KEY = '__pixishelf_adaptive_media_preview__'
export type AdaptivePreloadEnvironment = MediaPreloadEnvironment

interface AdaptiveMediaPreviewProps {
  images: ArtworkImageResponseDto[]
  initialIndex: number
  initialPreviewSrc?: string
  open: boolean
  onClose: (finalIndex: number) => void
  reading?: ArtworkReadingHandle
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

function AdaptiveMediaPreviewContent({
  images,
  initialIndex,
  initialPreviewSrc,
  open,
  onClose,
  reading
}: AdaptiveMediaPreviewProps) {
  const safeInitialIndex = clampIndex(initialIndex, images.length)
  const [currentIndex, setCurrentIndex] = useState(safeInitialIndex)
  const [zoomScale, setZoomScale] = useState(1)
  const animation = useArtworkAnimation(images[currentIndex]?.id, 'slideshow', previewResourceKey(images[currentIndex]))
  const [diagnosticsEnabled, setDiagnosticsEnabled] = useState(false)
  const [diagnosticRunning, setDiagnosticRunning] = useState(false)
  const [diagnosticVisible, setDiagnosticVisible] = useState(false)
  const [diagnosticResults, setDiagnosticResults] = useState<WebpDiagnosticResult[]>([])
  const diagnosticCanvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    setDiagnosticsEnabled(new URLSearchParams(window.location.search).get('webpDiagnostics') === '1')
  }, [])
  const isWebpPlaying = animation.playing
  const [decodedIndexes, setDecodedIndexes] = useState<Set<string>>(() => new Set())
  const [errorIndexes, setErrorIndexes] = useState<Set<string>>(() => new Set())
  const [retryCounts, setRetryCounts] = useState<Record<number, number>>({})
  const [transitioning, setTransitioning] = useState(false)
  const [webpProgress, setWebpProgress] = useState<{ key: string; percent: number | null } | null>(null)
  const autoSlideshowSelected = useArtworkAutoBrowseStore((state) => state.mode === 'slideshow')
  const autoStatus = useArtworkAutoBrowseStore((state) => state.status)
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

  useReaderMediaWindow(
    'adaptive',
    images.slice(Math.max(0, currentIndex - 1), currentIndex + 3).map((media) => media.id),
    open
  )
  const activeMedia = images[currentIndex]
  const mark = useMediaMark(activeMedia?.artworkId ?? 0, open ? (activeMedia?.id ?? null) : null)
  usePrefetchMediaMarks(
    activeMedia?.artworkId ?? 0,
    images.slice(Math.max(0, currentIndex - 1), currentIndex + 3).map((media) => media.id),
    open
  )
  const originalIndex = activeMedia
    ? (readingMediaPosition(reading, activeMedia.id)?.index ?? currentIndex)
    : currentIndex
  const originalTotal = reading?.context?.media.length ?? images.length
  const activeMediaId = activeMedia?.id
  const activeMediaKey = previewResourceKey(activeMedia)
  const activeMediaReady = decodedIndexes.has(activeMediaKey) && !errorIndexes.has(activeMediaKey)
  const observe = reading?.observe
  const clearSurface = reading?.clearSurface
  const observationEpoch = reading?.observationEpoch
  useEffect(() => {
    if (!observe || !clearSurface || !activeMediaId) return
    const surfaceId = 'adaptive-preview'
    observe(surfaceId, {
      mediaId: activeMediaId,
      ready: activeMediaReady,
      visible: open && !transitioning && !diagnosticRunning,
      automatic: autoSlideshowSelected && ['running', 'waiting'].includes(autoStatus),
      active: open,
      priority: 100
    })
    return () => clearSurface(surfaceId)
  }, [
    activeMediaId,
    activeMediaReady,
    autoSlideshowSelected,
    autoStatus,
    clearSurface,
    observationEpoch,
    observe,
    open,
    transitioning,
    diagnosticRunning
  ])
  const activeProgress = webpProgress?.key === previewResourceKey(activeMedia) ? webpProgress.percent : null
  const activePlayableWebp = useMemo(() => (activeMedia ? isPlayableAnimatedWebp(activeMedia) : false), [activeMedia])
  const eagerNeighborIndexes = useMemo(() => {
    const indexes = new Set<number>()
    for (const index of [currentIndex - 1, currentIndex + 1, currentIndex + 2]) {
      const media = images[index]
      if (media && !media.detailsPending && canPreloadAdaptiveNeighbor(media, preloadEnvironment)) indexes.add(index)
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
    enabled: open && !diagnosticRunning,
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

  const webpControl = (
    <button
      type="button"
      className="preview-webp-control pointer-events-auto min-h-11 min-w-11 shrink-0"
      aria-label={animationPlaybackLabel(isWebpPlaying, animation.playOnce, 'WEBP', activeProgress)}
      data-auto-browse-controls
      aria-pressed={isWebpPlaying}
      onClick={() => {
        animation.onPlayingChange(!isWebpPlaying)
      }}
    >
      <AnimationPlaybackCapsule
        appearance="segment"
        playing={isWebpPlaying}
        playOnce={animation.playOnce}
        label="WEBP"
        fileSize={formatAnimationFileSize(activeMedia?.size)}
        progressPercent={activeProgress}
      />
    </button>
  )

  return (
    <VerticalMediaPreviewCore
      items={images}
      itemKey={(media, index) => media.id || index}
      initialIndex={safeInitialIndex}
      counterIndex={originalIndex}
      counterTotal={originalTotal}
      showTopCounter={false}
      enableMousewheel
      onLike={() => {
        if (mark.available && !mark.isLoading && !activeMedia?.detailsPending) mark.set('like', true)
      }}
      onToggleLike={() => {
        if (mark.available && !mark.isLoading && !activeMedia?.detailsPending) mark.set('like', !mark.likedAt)
      }}
      transitionEffect="fade"
      open={open}
      onClose={(finalIndex) => {
        animation.stopManual()
        onClose(finalIndex)
      }}
      historyKey={ADAPTIVE_PREVIEW_HISTORY_KEY}
      title="适配尺寸媒体预览"
      description="上下滑动或滚动鼠标滚轮切换媒体，空格切换当前图片喜欢，双击喜欢当前图片，双指缩放；WebP 动图可通过底部按钮播放或暂停。"
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
        if (media.detailsPending) return <MediaDetailsPlaceholder media={media} index={index} fill />
        const currentProgressGeneration = progressGeneration.current
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
                alt={`作品媒体 ${(readingMediaPosition(reading, media.id)?.index ?? index) + 1}`}
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
            {diagnosticsEnabled && index === currentIndex && playableAnimatedWebp && (
              <div className="pointer-events-none absolute inset-0 px-0 py-16 sm:px-12 sm:py-20">
                <canvas
                  ref={diagnosticCanvas}
                  data-webp-diagnostic-canvas
                  aria-label="WebP 诊断画面"
                  className={cn('h-full w-full object-contain', !diagnosticVisible && 'invisible')}
                />
              </div>
            )}
          </div>
        )
      }}
      bottomChrome={({ portalContainer: container }) => (
        <div className="pointer-events-none absolute inset-x-4 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-20 h-12">
          {reading && (reading.invalidated || reading.markError) && (
            <div className="pointer-events-auto absolute inset-x-0 bottom-28 mx-auto w-fit max-w-full rounded-lg bg-background text-foreground sm:bottom-14">
              {reading.invalidated ? (
                <div className="flex flex-wrap items-center gap-2 p-3 text-sm" role="status">
                  <span>作品媒体已更新，请重新打开阅读。</span>
                  <Button size="sm" variant="outline" onClick={reading.reopen}>
                    重新打开
                  </Button>
                </div>
              ) : null}
              {reading.markError && (
                <p role="alert" className="px-3 pb-2 text-sm text-destructive">
                  {reading.markError}
                </p>
              )}
            </div>
          )}
          {diagnosticsEnabled && open && activePlayableWebp && activeMedia && (
            <WebpDiagnosticsPanel
              src={withMediaVersion(combinationApiResource(activeMedia.path), activeMedia.updatedAt)}
              size={activeMedia.size}
              canvas={diagnosticCanvas}
              results={diagnosticResults}
              onResult={(result) => setDiagnosticResults((current) => [...current, result].slice(-10))}
              onRunning={setDiagnosticRunning}
              onVisible={setDiagnosticVisible}
              onStart={() => {
                useArtworkAutoBrowseStore.getState().pause('manual')
                useArtworkAutoBrowseStore.getState().setActiveAnimation(null)
                animation.stopManual()
              }}
            />
          )}
          {activeMedia && (
            <div className="pointer-events-auto mx-auto flex h-12 w-fit max-w-full items-center">
              <MediaMarkActions artworkId={activeMedia.artworkId ?? 0} mediaId={activeMedia.id} overlay>
                {!diagnosticRunning &&
                  (images.length > 1 ? (
                    <AutoBrowseControls
                      compact
                      mode="slideshow"
                      trailingControl={activePlayableWebp ? webpControl : undefined}
                      current={originalIndex + 1}
                      total={originalTotal}
                      navigation={
                        <span className="px-2 text-sm tabular-nums">
                          {originalIndex + 1}/{originalTotal}
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
                  ) : (
                    <div className="preview-playback-controls flex h-12 items-center rounded-full p-0.5">
                      <span className="px-3 text-xs tabular-nums" aria-live="polite">
                        {originalIndex + 1}/{originalTotal}
                      </span>
                      {activePlayableWebp ? <div className="preview-playback-trailing border-l">{webpControl}</div> : null}
                    </div>
                  ))}
              </MediaMarkActions>
            </div>
          )}
        </div>
      )}
    />
  )
}

export default function AdaptiveMediaPreview(props: AdaptiveMediaPreviewProps) {
  return (
    <WebpPreviewSession open={props.open} scopeKey={String(props.images[0]?.id ?? 'empty')}>
      <AdaptiveMediaPreviewContent {...props} />
    </WebpPreviewSession>
  )
}
