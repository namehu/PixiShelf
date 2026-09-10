'use client'

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { ChevronDownIcon, ChevronUpIcon, XIcon } from 'lucide-react'
import { Keyboard, Virtual, Zoom } from 'swiper/modules'
import { Swiper, SwiperSlide } from 'swiper/react'
import type { Swiper as SwiperType } from 'swiper'
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog'

import 'swiper/css'
import 'swiper/css/virtual'
import 'swiper/css/zoom'

export interface VerticalMediaPreviewController {
  slideNext: (speed?: number) => void
  slidePrev: (speed?: number) => void
  slideTo: (index: number, speed?: number) => void
}

export interface VerticalMediaPreviewRenderContext {
  active: boolean
  eager: boolean
  index: number
}

export interface VerticalMediaPreviewChromeContext {
  activeIndex: number
  portalContainer: HTMLElement | null
  transitioning: boolean
  zoomScale: number
}

interface VerticalMediaPreviewCoreProps<T> {
  items: T[]
  itemKey: (item: T, index: number) => string | number
  initialIndex: number
  open: boolean
  onClose: (finalIndex: number) => void
  renderSlide: (item: T, context: VerticalMediaPreviewRenderContext) => ReactNode
  title: string
  description: string
  closeLabel: string
  historyKey: string
  testId?: string
  counterTotal?: number | null
  bottomChrome?: (context: VerticalMediaPreviewChromeContext) => ReactNode
  onActiveIndexChange?: (index: number) => void
  onZoomChange?: (scale: number) => void
  onTouchStart?: () => void
  onTransitioningChange?: (transitioning: boolean) => void
  onControllerChange?: (controller: VerticalMediaPreviewController | null) => void
  onBeforeClose?: () => void
  onManualNavigation?: () => void
}

function asHistoryRecord(state: unknown): Record<string, unknown> {
  return typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as Record<string, unknown>) : {}
}

function createHistoryToken() {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random()}`
}

function clampIndex(index: number, length: number) {
  return Math.min(Math.max(index, 0), Math.max(0, length - 1))
}

export function VerticalMediaPreviewCore<T>({
  items,
  itemKey,
  initialIndex,
  open,
  onClose,
  renderSlide,
  title,
  description,
  closeLabel,
  historyKey,
  testId = 'vertical-media-preview-swiper',
  counterTotal,
  bottomChrome,
  onActiveIndexChange,
  onZoomChange,
  onTouchStart,
  onTransitioningChange,
  onControllerChange,
  onBeforeClose,
  onManualNavigation
}: VerticalMediaPreviewCoreProps<T>) {
  const safeInitialIndex = clampIndex(initialIndex, items.length)
  const [activeIndex, setActiveIndex] = useState(safeInitialIndex)
  const [zoomScale, setZoomScale] = useState(1)
  const [transitioning, setTransitioning] = useState(false)
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)
  const swiperRef = useRef<SwiperType | null>(null)
  const activeIndexRef = useRef(safeInitialIndex)
  const openRef = useRef(open)
  const historyTokenRef = useRef<string | null>(null)
  const historyClosePendingRef = useRef(false)
  const sessionStartedRef = useRef(false)
  const beforeCloseCalledRef = useRef(false)
  const onCloseRef = useRef(onClose)
  const onBeforeCloseRef = useRef(onBeforeClose)
  const initialIndexRef = useRef(initialIndex)
  const itemCountRef = useRef(items.length)
  const historyKeyRef = useRef(historyKey)

  initialIndexRef.current = initialIndex
  itemCountRef.current = items.length
  historyKeyRef.current = historyKey

  useEffect(() => {
    onCloseRef.current = onClose
    onBeforeCloseRef.current = onBeforeClose
  }, [onBeforeClose, onClose])

  const isCurrentHistoryEntry = useCallback((state: unknown = history.state) => {
    const token = historyTokenRef.current
    return Boolean(token && asHistoryRecord(state)[historyKeyRef.current] === token)
  }, [])

  const runBeforeClose = useCallback(() => {
    if (beforeCloseCalledRef.current) return
    beforeCloseCalledRef.current = true
    onBeforeCloseRef.current?.()
  }, [])

  const finishClose = useCallback(() => {
    if (!openRef.current) return
    openRef.current = false
    historyClosePendingRef.current = false
    runBeforeClose()
    onCloseRef.current(activeIndexRef.current)
  }, [runBeforeClose])

  const requestClose = useCallback(() => {
    if (!openRef.current || historyClosePendingRef.current) return
    runBeforeClose()
    if (typeof window !== 'undefined' && isCurrentHistoryEntry()) {
      historyClosePendingRef.current = true
      history.back()
      return
    }
    finishClose()
  }, [finishClose, isCurrentHistoryEntry, runBeforeClose])

  useEffect(() => {
    if (!open || typeof window === 'undefined') {
      if (openRef.current && sessionStartedRef.current && isCurrentHistoryEntry()) {
        openRef.current = false
        history.back()
      }
      openRef.current = false
      sessionStartedRef.current = false
      return
    }

    if (!sessionStartedRef.current) {
      const nextIndex = clampIndex(initialIndexRef.current, itemCountRef.current)
      activeIndexRef.current = nextIndex
      setActiveIndex(nextIndex)
      setZoomScale(1)
      openRef.current = true
      historyClosePendingRef.current = false
      beforeCloseCalledRef.current = false
      historyTokenRef.current = createHistoryToken()
      history.pushState(
        { ...asHistoryRecord(history.state), [historyKeyRef.current]: historyTokenRef.current },
        '',
        window.location.href
      )
      sessionStartedRef.current = true
    }

    const handlePopState = (event: PopStateEvent) => {
      if (!openRef.current) return
      if (historyClosePendingRef.current || !isCurrentHistoryEntry(event.state)) finishClose()
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [finishClose, isCurrentHistoryEntry, open])

  useEffect(() => {
    if (activeIndex < items.length) return
    const nextIndex = clampIndex(activeIndex, items.length)
    activeIndexRef.current = nextIndex
    setActiveIndex(nextIndex)
  }, [activeIndex, items.length])

  if (!items.length) return null

  const displayTotal = counterTotal ?? items.length
  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && requestClose()}>
      <DialogContent
        ref={setPortalContainer}
        showCloseButton={false}
        className="fixed inset-0 left-0 top-0 z-[100] block h-[100dvh] w-screen max-w-none translate-x-0 translate-y-0 gap-0 overflow-hidden rounded-none border-0 bg-black p-0 text-white shadow-none sm:max-w-none"
        onPointerDownOutside={(event) => event.preventDefault()}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <DialogDescription className="sr-only">{description}</DialogDescription>

        <div className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between bg-gradient-to-b from-black/75 via-black/35 to-transparent px-3 pb-8 pt-[calc(0.75rem+env(safe-area-inset-top))] sm:px-5">
          <div
            className="rounded-full bg-black/35 px-3 py-1.5 text-sm font-medium tabular-nums backdrop-blur-md"
            aria-live="polite"
          >
            {activeIndex + 1} / {displayTotal}
          </div>
          <button
            type="button"
            onClick={requestClose}
            className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-md transition-colors hover:bg-white/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
            aria-label={closeLabel}
          >
            <XIcon className="size-6" aria-hidden="true" />
          </button>
        </div>

        <Swiper
          modules={[Keyboard, Virtual, Zoom]}
          initialSlide={safeInitialIndex}
          direction="vertical"
          keyboard={{ enabled: true, onlyInViewport: false, pageUpDown: true }}
          virtual={{ addSlidesBefore: 1, addSlidesAfter: 1 }}
          zoom={{ minRatio: 1, maxRatio: 3, toggle: true }}
          resistanceRatio={0.65}
          spaceBetween={12}
          onSwiper={(swiper) => {
            swiperRef.current = swiper
            onControllerChange?.(swiper)
          }}
          onBeforeDestroy={() => {
            swiperRef.current = null
            onControllerChange?.(null)
          }}
          onSlideChange={(swiper) => {
            const nextIndex = clampIndex(swiper.activeIndex, itemCountRef.current)
            activeIndexRef.current = nextIndex
            setActiveIndex(nextIndex)
            setZoomScale(1)
            swiper.allowSlideNext = true
            swiper.allowSlidePrev = true
            onActiveIndexChange?.(nextIndex)
            onZoomChange?.(1)
          }}
          onZoomChange={(swiper, scale) => {
            const isZoomed = scale > 1.01
            setZoomScale(scale)
            swiper.allowSlideNext = !isZoomed
            swiper.allowSlidePrev = !isZoomed
            onZoomChange?.(scale)
          }}
          onTouchStart={() => {
            onManualNavigation?.()
            onTouchStart?.()
          }}
          onSlideChangeTransitionStart={() => {
            setTransitioning(true)
            onTransitioningChange?.(true)
          }}
          onSlideChangeTransitionEnd={() => {
            setTransitioning(false)
            onTransitioningChange?.(false)
          }}
          className="h-full w-full"
          data-testid={testId}
        >
          {items.map((item, index) => (
            <SwiperSlide
              key={itemKey(item, index)}
              virtualIndex={index}
              className="flex h-full items-center justify-center overflow-hidden"
            >
              {renderSlide(item, {
                active: index === activeIndex,
                eager: Math.abs(index - activeIndex) <= 2,
                index
              })}
            </SwiperSlide>
          ))}
        </Swiper>

        {items.length > 1 && (
          <div className="pointer-events-none absolute right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2 sm:flex">
            <button
              type="button"
              onClick={() => {
                onManualNavigation?.()
                swiperRef.current?.slidePrev()
              }}
              disabled={activeIndex === 0 || zoomScale > 1.01}
              className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-25"
              aria-label="上一张媒体"
            >
              <ChevronUpIcon className="size-7" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={() => {
                onManualNavigation?.()
                swiperRef.current?.slideNext()
              }}
              disabled={activeIndex === items.length - 1 || zoomScale > 1.01}
              className="pointer-events-auto flex size-12 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-md transition-colors hover:bg-white/20 disabled:pointer-events-none disabled:opacity-25"
              aria-label="下一张媒体"
            >
              <ChevronDownIcon className="size-7" aria-hidden="true" />
            </button>
          </div>
        )}

        {bottomChrome?.({ activeIndex, portalContainer, transitioning, zoomScale })}
      </DialogContent>
    </Dialog>
  )
}
