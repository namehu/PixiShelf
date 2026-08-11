'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Image from 'next/image'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { Keyboard, Virtual, Zoom } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import type { Swiper as SwiperType } from 'swiper'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import { isApngFile, isGifFile, isWebpFile } from '@/lib/media'

import 'swiper/css'
import 'swiper/css/zoom'
import 'swiper/css/virtual'

const ADAPTIVE_PREVIEW_HISTORY_KEY = '__pixishelf_adaptive_media_preview__'

interface AdaptiveMediaPreviewProps {
  images: ArtworkImageResponseDto[]
  initialIndex: number
  open: boolean
  onClose: (finalIndex: number) => void
}

function asHistoryRecord(state: unknown): Record<string, unknown> {
  return typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as Record<string, unknown>) : {}
}

function createHistoryToken() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

function isAnimatedMedia(media: ArtworkImageResponseDto) {
  return Boolean(media.isAnimated) && (isApngFile(media.path) || isGifFile(media.path) || isWebpFile(media.path))
}

function clampIndex(index: number, length: number) {
  return Math.min(Math.max(index, 0), Math.max(0, length - 1))
}

export default function AdaptiveMediaPreview({ images, initialIndex, open, onClose }: AdaptiveMediaPreviewProps) {
  const safeInitialIndex = clampIndex(initialIndex, images.length)
  const [currentIndex, setCurrentIndex] = useState(safeInitialIndex)
  const [zoomScale, setZoomScale] = useState(1)
  const swiperRef = useRef<SwiperType | null>(null)
  const currentIndexRef = useRef(safeInitialIndex)
  const openRef = useRef(open)
  const historyTokenRef = useRef<string | null>(null)
  const historyClosePendingRef = useRef(false)
  const onCloseRef = useRef(onClose)

  useEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  const isCurrentHistoryEntry = useCallback((state: unknown = history.state) => {
    const token = historyTokenRef.current
    return Boolean(token && asHistoryRecord(state)[ADAPTIVE_PREVIEW_HISTORY_KEY] === token)
  }, [])

  const finishClose = useCallback(() => {
    if (!openRef.current) return

    openRef.current = false
    historyClosePendingRef.current = false
    onCloseRef.current(currentIndexRef.current)
  }, [])

  const requestClose = useCallback(() => {
    if (!openRef.current || historyClosePendingRef.current) return

    if (typeof window !== 'undefined' && isCurrentHistoryEntry()) {
      historyClosePendingRef.current = true
      history.back()
      return
    }

    finishClose()
  }, [finishClose, isCurrentHistoryEntry])

  useEffect(() => {
    if (!open || typeof window === 'undefined') return

    const nextIndex = clampIndex(initialIndex, images.length)
    currentIndexRef.current = nextIndex
    setCurrentIndex(nextIndex)
    setZoomScale(1)
    openRef.current = true
    historyClosePendingRef.current = false
    historyTokenRef.current = createHistoryToken()

    history.pushState(
      {
        ...asHistoryRecord(history.state),
        [ADAPTIVE_PREVIEW_HISTORY_KEY]: historyTokenRef.current
      },
      '',
      window.location.href
    )

    const handlePopState = (event: PopStateEvent) => {
      if (!openRef.current) return

      if (historyClosePendingRef.current || !isCurrentHistoryEntry(event.state)) {
        finishClose()
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [finishClose, images.length, initialIndex, isCurrentHistoryEntry, open])

  useEffect(() => {
    if (open) return
    openRef.current = false
  }, [open])

  const activeMedia = images[currentIndex]
  const activeAnimated = useMemo(() => (activeMedia ? isAnimatedMedia(activeMedia) : false), [activeMedia])

  const handleSlideChange = useCallback(
    (swiper: SwiperType) => {
      const nextIndex = clampIndex(swiper.activeIndex, images.length)
      currentIndexRef.current = nextIndex
      setCurrentIndex(nextIndex)
      setZoomScale(1)
      swiper.allowSlideNext = true
      swiper.allowSlidePrev = true
    },
    [images.length]
  )

  const handleZoomChange = useCallback((swiper: SwiperType, scale: number) => {
    const isZoomed = scale > 1.01
    setZoomScale(scale)
    swiper.allowSlideNext = !isZoomed
    swiper.allowSlidePrev = !isZoomed
  }, [])

  if (!images.length) return null

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 left-0 top-0 z-[100] block h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white shadow-none sm:max-w-none"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">适配尺寸媒体预览</DialogTitle>
        <DialogDescription className="sr-only">左右滑动切换媒体，双指或双击缩放图片。</DialogDescription>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/75 via-black/35 to-transparent px-3 pb-8 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-5">
          <div
            className="rounded-full bg-black/35 px-3 py-1.5 text-sm font-medium tabular-nums backdrop-blur-md"
            aria-live="polite"
          >
            {currentIndex + 1} / {images.length}
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label="关闭适配尺寸预览"
          >
            <X className="size-6" />
          </button>
        </div>

        <Swiper
          modules={[Keyboard, Virtual, Zoom]}
          initialSlide={safeInitialIndex}
          direction="horizontal"
          keyboard={{ enabled: true, onlyInViewport: false }}
          virtual={{ addSlidesBefore: 1, addSlidesAfter: 1 }}
          zoom={{ minRatio: 1, maxRatio: 3, toggle: true }}
          resistanceRatio={0.65}
          spaceBetween={12}
          onSwiper={(swiper) => {
            swiperRef.current = swiper
          }}
          onBeforeDestroy={() => {
            swiperRef.current = null
          }}
          onSlideChange={handleSlideChange}
          onZoomChange={handleZoomChange}
          className="h-full w-full"
          data-testid="adaptive-media-preview-swiper"
        >
          {images.map((media, index) => {
            const animated = isAnimatedMedia(media)

            return (
              <SwiperSlide
                key={media.id || index}
                virtualIndex={index}
                className="flex h-full items-center justify-center overflow-hidden"
              >
                <div className="swiper-zoom-container relative h-full w-full px-0 py-16 sm:px-12 sm:py-20">
                  <Image
                    src={media.path}
                    alt={`作品媒体 ${index + 1}`}
                    fill
                    sizes="100vw"
                    quality={95}
                    priority={Math.abs(index - safeInitialIndex) <= 1}
                    loading={Math.abs(index - safeInitialIndex) <= 1 ? 'eager' : 'lazy'}
                    draggable={false}
                    className="select-none object-contain"
                  />
                  {animated && (
                    <span className="pointer-events-none absolute bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-1/2 -translate-x-1/2 rounded-full bg-black/65 px-3 py-1 text-xs text-white/85 backdrop-blur-md">
                      动图静态预览
                    </span>
                  )}
                </div>
              </SwiperSlide>
            )
          })}
        </Swiper>

        {images.length > 1 && (
          <div className="pointer-events-none absolute inset-x-4 top-1/2 z-20 hidden -translate-y-1/2 items-center justify-between sm:flex">
            <button
              type="button"
              onClick={() => swiperRef.current?.slidePrev()}
              disabled={currentIndex === 0 || zoomScale > 1.01}
              className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-all hover:bg-white/20 disabled:pointer-events-none disabled:opacity-25"
              aria-label="上一张媒体"
            >
              <ChevronLeft className="size-7" />
            </button>
            <button
              type="button"
              onClick={() => swiperRef.current?.slideNext()}
              disabled={currentIndex === images.length - 1 || zoomScale > 1.01}
              className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-all hover:bg-white/20 disabled:pointer-events-none disabled:opacity-25"
              aria-label="下一张媒体"
            >
              <ChevronRight className="size-7" />
            </button>
          </div>
        )}

        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center bg-gradient-to-t from-black/65 to-transparent px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-10">
          <span className="rounded-full bg-black/35 px-3 py-1 text-xs text-white/75 backdrop-blur-md">
            {zoomScale > 1.01
              ? `${zoomScale.toFixed(1)}× · 拖动查看，缩小后切换`
              : activeAnimated
                ? '静态适配预览 · 长按原媒体可查看原文件'
                : '左右切换 · 双指或双击缩放'}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  )
}
