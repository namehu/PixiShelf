'use client'

import { Swiper, SwiperSlide } from 'swiper/react'
import { Mousewheel, Keyboard } from 'swiper/modules'
import ImageSlide from './image-slide'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Swiper as SwiperType } from 'swiper'

// 导入 Swiper 的核心和模块样式
import 'swiper/css'
import 'swiper/css/mousewheel'
import 'swiper/css/keyboard'
import { RandomImageItem } from '@/types/images'
import { useViewerStore } from '@/store/viewer-store'
import { Placeholder } from './placeholder'
import { useShallow } from 'zustand/react/shallow'
import type { ViewerAudioPreference } from './viewer-video-controls'
import { useArtworkReading } from '@/lib/reading/reading-provider'
import { Button } from '@/components/ui/button'
import { createFeedGestureEngine, type FeedGestureEngine } from '@/components/players/video-feed-gesture-engine'

const VIEWER_CHAPTER_HISTORY_KEY = '__pixishelf_viewer_chapters__'

function asHistoryRecord(state: unknown): Record<string, unknown> {
  return typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as Record<string, unknown>) : {}
}

function useChapterPanelHistory() {
  const [open, setOpenState] = useState(false)
  const openRef = useRef(false)
  const tokenRef = useRef<string | null>(null)
  const historyClosePendingRef = useRef(false)

  const getToken = useCallback(() => {
    if (!tokenRef.current) {
      tokenRef.current =
        typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`
    }
    return tokenRef.current
  }, [])

  const isCurrentEntry = useCallback(
    (state: unknown = history.state) => asHistoryRecord(state)[VIEWER_CHAPTER_HISTORY_KEY] === getToken(),
    [getToken]
  )

  const pushEntry = useCallback(() => {
    if (typeof window === 'undefined' || historyClosePendingRef.current || isCurrentEntry()) return

    history.pushState(
      { ...asHistoryRecord(history.state), [VIEWER_CHAPTER_HISTORY_KEY]: getToken() },
      '',
      window.location.href
    )
  }, [getToken, isCurrentEntry])

  const setOpen = useCallback(
    (nextOpen: boolean) => {
      if (openRef.current === nextOpen) return

      openRef.current = nextOpen
      setOpenState(nextOpen)

      if (typeof window === 'undefined') return
      if (nextOpen) {
        pushEntry()
      } else if (isCurrentEntry()) {
        historyClosePendingRef.current = true
        history.back()
      }
    },
    [isCurrentEntry, pushEntry]
  )

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (historyClosePendingRef.current) {
        historyClosePendingRef.current = false
        if (openRef.current) pushEntry()
        return
      }

      if (openRef.current && !isCurrentEntry(event.state)) {
        openRef.current = false
        setOpenState(false)
      }
    }

    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [isCurrentEntry, pushEntry])

  return [open, setOpen] as const
}

interface ImmersiveImageViewerProps {
  initialImages: RandomImageItem[]
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => Promise<unknown> | void
  loadMoreError?: boolean
  interactionLocked?: boolean
}

function ViewerEndSurface({ active, onToggleChrome }: { active: boolean; onToggleChrome: () => void }) {
  const engineRef = useRef<FeedGestureEngine | null>(null)
  const isChromeHidden = useViewerStore((state) => state.isChromeHidden)
  useEffect(() => {
    engineRef.current?.pointerCancel()
  }, [isChromeHidden])
  useEffect(() => {
    if (!active) return
    const noop = () => undefined
    const engine = createFeedGestureEngine({
      mediaKind: 'image',
      longPressRate: 2,
      seekStepSeconds: 10,
      getSurfaceRect: () => ({ left: 0, width: 0 }),
      getPlaying: () => false,
      getCurrentTime: () => 0,
      getDuration: () => 0,
      getPlaybackRate: () => 1,
      setPlaybackRate: noop,
      onSeek: noop,
      onLike: noop,
      onOpenActions: noop,
      onFeedback: noop,
      onToggleChrome
    })
    engineRef.current = engine
    window.addEventListener('blur', engine.pointerCancel)
    return () => {
      window.removeEventListener('blur', engine.pointerCancel)
      engine.destroy()
      engineRef.current = null
    }
  }, [active, onToggleChrome])
  return (
    <div
      className="flex h-full w-full items-center justify-center text-center"
      onPointerDown={(event) => engineRef.current?.pointerDown(event)}
      onPointerMove={(event) => engineRef.current?.pointerMove(event)}
      onPointerUp={(event) => engineRef.current?.pointerUp(event)}
      onPointerCancel={() => engineRef.current?.pointerCancel()}
    >
      <p className="text-sm opacity-60">已浏览全部作品</p>
    </div>
  )
}

/**
 * 沉浸式图片浏览器组件
 * 使用Swiper实现垂直滑动切换，支持无限滚动加载
 * 集成状态管理，支持浏览位置恢复
 */
export default function ImmersiveImageViewer({
  initialImages,
  onLoadMore,
  hasMore,
  isLoading,
  loadMoreError = false,
  interactionLocked = false
}: ImmersiveImageViewerProps) {
  const [audioPreference, setAudioPreference] = useState<ViewerAudioPreference>({ muted: true, volume: 1 })
  const [chapterPanelOpen, setChapterPanelOpen] = useChapterPanelHistory()
  const [preloadUnlockedIndex, setPreloadUnlockedIndex] = useState<number | null>(null)
  const [overlayPanelOpen, setOverlayPanelOpen] = useState(false)
  const [atEnd, setAtEnd] = useState(false)
  const [swiper, setSwiper] = useState<SwiperType | null>(null)
  const controlsLocked = interactionLocked || chapterPanelOpen || overlayPanelOpen
  const autoStatus = useViewerStore((state) => state.autoBrowseStatus)
  const autoWait = useViewerStore((state) => state.autoBrowseWait)
  const startRequested = useViewerStore((state) => state.autoBrowseStartRequested)
  const [pointerHeld, setPointerHeld] = useState(false)
  const pointerHeldRef = useRef(false)
  const [transitioning, setTransitioning] = useState(false)
  const [pendingNext, setPendingNext] = useState<string | null>(null)
  const [pageFailed, setPageFailed] = useState(false)
  const fetchingRef = useRef(false)
  const lifetimeRef = useRef(0)
  const latest = useRef({ initialImages, hasMore, controlsLocked, swiper })
  latest.current = { initialImages, hasMore, controlsLocked, swiper }
  const isNavigationBlocked = useCallback(
    () =>
      pointerHeldRef.current ||
      latest.current.controlsLocked ||
      Boolean(latest.current.swiper?.animating) ||
      document.visibilityState === 'hidden',
    []
  )
  useEffect(() => {
    const release = () => {
      pointerHeldRef.current = false
      setPointerHeld(false)
    }
    const visibility = () => {
      if (document.visibilityState === 'hidden') {
        release()
        useViewerStore.getState().pauseAutoBrowse('background')
      }
    }
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      lifetimeRef.current += 1
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', visibility)
      useViewerStore.getState().stopAutoBrowse()
    }
  }, [])
  useEffect(() => {
    if (controlsLocked) useViewerStore.getState().pauseAutoBrowse('panel')
  }, [controlsLocked])
  useEffect(() => {
    if (startRequested && !controlsLocked && document.visibilityState !== 'hidden') {
      useViewerStore.getState().runAutoBrowse()
    }
  }, [startRequested, controlsLocked])
  useEffect(() => {
    if (autoStatus === 'off' || autoStatus === 'ended') setPendingNext(null)
  }, [autoStatus])
  useEffect(() => {
    if (!swiper || swiper.destroyed) return
    // Swiper React does not sync allowTouchMove or detach module listeners on prop changes.
    swiper.allowTouchMove = !controlsLocked
    if (controlsLocked) {
      swiper.keyboard.disable()
      swiper.mousewheel.disable()
    } else {
      swiper.keyboard.enable()
      swiper.mousewheel.enable()
    }
  }, [controlsLocked, swiper])
  const playbackPositionsRef = useRef(new Map<number, number>())
  const { setVerticalIndex, verticalIndex, horizontalIndexes, isChromeHidden, setChromeHidden, toggleChromeHidden } =
    useViewerStore(
      useShallow((state) => ({
        verticalIndex: state.verticalIndex,
        horizontalIndexes: state.horizontalIndexes,
        setVerticalIndex: state.setVerticalIndex,
        isChromeHidden: state.isChromeHidden,
        setChromeHidden: state.setChromeHidden,
        toggleChromeHidden: state.toggleChromeHidden
      }))
    )
  const hideChrome = useCallback(() => setChromeHidden(true), [setChromeHidden])
  useEffect(() => {
    // Cached filter results can reset the store without remounting Swiper.
    if (swiper && !swiper.destroyed && !atEnd && swiper.activeIndex !== verticalIndex) {
      swiper.slideTo(verticalIndex, 0)
    }
  }, [atEnd, swiper, verticalIndex])
  const reading = useArtworkReading(atEnd ? 0 : (initialImages[verticalIndex]?.id ?? 0))

  const requestMore = useCallback(async () => {
    if (fetchingRef.current) return
    const lifetime = lifetimeRef.current
    const session = useViewerStore.getState().autoBrowseSession
    fetchingRef.current = true
    setPageFailed(false)
    try {
      await onLoadMore()
    } catch {
      if (lifetime !== lifetimeRef.current) return
      setPageFailed(true)
      if (session === useViewerStore.getState().autoBrowseSession) {
        useViewerStore.getState().pauseAutoBrowse('page-error')
      }
    } finally {
      fetchingRef.current = false
    }
  }, [onLoadMore])
  const completeArtwork = useCallback(() => {
    const state = useViewerStore.getState()
    const current = latest.current.initialImages[state.verticalIndex]
    if (state.autoBrowseStatus === 'running' && current) {
      setPendingNext(`${current.key}:${state.horizontalIndexes[current.key] ?? 0}`)
    }
  }, [])
  const cancelArtworkComplete = useCallback(() => {
    setPendingNext(null)
    useViewerStore.getState().setAutoBrowseWait(null)
  }, [])
  useEffect(() => {
    if (!pendingNext) return
    const current = initialImages[verticalIndex]
    if (!current || `${current.key}:${horizontalIndexes[current.key] ?? 0}` !== pendingNext) {
      setPendingNext(null)
      useViewerStore.getState().setAutoBrowseWait(null)
      return
    }
    if (autoStatus !== 'running' || controlsLocked || pointerHeld || transitioning || isNavigationBlocked()) return
    const state = useViewerStore.getState()
    const next = initialImages[verticalIndex + 1]
    if (next && swiper && !swiper.destroyed) {
      setPendingNext(null)
      state.setAutoBrowseWait(null)
      state.setHorizontalIndex(next.key, 0)
      state.restartAutoBrowseMedia(next.images[0]?.id ?? next.id)
      swiper.slideTo(verticalIndex + 1)
    } else if (!hasMore && swiper && !swiper.destroyed) {
      setPendingNext(null)
      state.stopAutoBrowse(true)
      swiper.slideTo(initialImages.length)
    } else if (pageFailed || loadMoreError) {
      state.pauseAutoBrowse('page-error')
    } else {
      state.setAutoBrowseWait('page')
      if (!isLoading) void requestMore()
    }
  }, [
    pendingNext,
    initialImages,
    verticalIndex,
    horizontalIndexes,
    autoStatus,
    controlsLocked,
    pointerHeld,
    transitioning,
    isNavigationBlocked,
    swiper,
    hasMore,
    isLoading,
    pageFailed,
    loadMoreError,
    requestMore
  ])

  // 处理slide变化
  const handleSlideChange = useCallback(
    (swiper: SwiperType) => {
      setChapterPanelOpen(false)
      setPreloadUnlockedIndex(null)
      setAtEnd(swiper.activeIndex >= initialImages.length)
      if (swiper.activeIndex >= initialImages.length && useViewerStore.getState().autoBrowseStatus !== 'off') {
        useViewerStore.getState().stopAutoBrowse(true)
      }
      setVerticalIndex(swiper.activeIndex)
    },
    [initialImages.length, setChapterPanelOpen, setVerticalIndex]
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null
      const isInteractiveTarget = target?.closest(
        'a, button, input, select, textarea, [contenteditable], [role="slider"], [role="dialog"], [data-viewer-control]'
      )

      if (
        controlsLocked ||
        event.defaultPrevented ||
        event.repeat ||
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        target?.isContentEditable ||
        isInteractiveTarget
      ) {
        return
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        toggleChromeHidden()
      } else if (event.key === 'Escape' && isChromeHidden) {
        event.preventDefault()
        setChromeHidden(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [controlsLocked, toggleChromeHidden, setChromeHidden, isChromeHidden])

  return (
    // 桌面端适配容器
    <div
      className="h-full w-full bg-black md:flex md:items-center md:justify-center"
      data-auto-browse-status={autoStatus}
      data-auto-browse-wait={autoWait ?? undefined}
      onPointerDownCapture={() => {
        pointerHeldRef.current = true
        setPointerHeld(true)
      }}
    >
      {/* 沉浸式查看器主容器 */}
      <div className="immersive-container relative h-full w-full bg-black md:h-[90dvh] md:max-w-[420px] md:aspect-[9/16] md:rounded-surface">
        <Swiper
          onSwiper={setSwiper}
          initialSlide={verticalIndex}
          direction="vertical"
          className="h-full w-full !overflow-clip"
          allowTouchMove={!controlsLocked}
          // Bare videos are gesture surfaces, even after clicking them gives them focus.
          focusableElements="input, select, option, textarea, button, video[controls], label"
          // 桌面端配置
          mousewheel={{ enabled: !controlsLocked }}
          keyboard={{ enabled: !controlsLocked }}
          modules={[Mousewheel, Keyboard]}
          // 初始索引配置
          slidesPerView={1}
          lazyPreloadPrevNext={0}
          resistance={true}
          resistanceRatio={0.85}
          speed={300}
          onBeforeTransitionStart={() => setTransitioning(true)}
          onTransitionEnd={() => setTransitioning(false)}
          touchRatio={1}
          touchAngle={45}
          grabCursor={true}
          onReachEnd={() => {
            if (hasMore && !isLoading) {
              void requestMore()
            }
          }}
          onSlideChange={handleSlideChange}
        >
          {initialImages.map((image, index) => {
            // 1. 判断当前幻灯片是否是用户正在看的
            const isActive = !atEnd && index === verticalIndex
            // 2. 判断当前幻灯片是否是需要预加载的（即下一个或上一个）
            const isPreloading = Math.abs(index - verticalIndex) === 1
            // 3. 只有“活动”和“预加载”的幻灯片才会被渲染，其他都是占位符
            const shouldRender = isActive || isPreloading

            return (
              <SwiperSlide
                key={image.key}
                inert={!isActive}
                className="flex h-full w-full items-center justify-center overflow-hidden"
              >
                <div className="relative h-full w-full bg-black">
                  {shouldRender ? (
                    <ImageSlide
                      isActive={isActive}
                      preloadEntryMedia={index === verticalIndex + 1 && preloadUnlockedIndex === verticalIndex}
                      image={image}
                      reading={isActive ? reading : undefined}
                      onArtworkComplete={completeArtwork}
                      onCancelArtworkComplete={cancelArtworkComplete}
                      navigationBlocked={pointerHeld || transitioning}
                      navigationTransitioning={transitioning}
                      isNavigationBlocked={isNavigationBlocked}
                      interactionLocked={controlsLocked}
                      onOverlayPanelOpenChange={setOverlayPanelOpen}
                      audioPreference={audioPreference}
                      onAudioPreferenceChange={setAudioPreference}
                      chapterPanelOpen={chapterPanelOpen}
                      onChapterPanelOpenChange={setChapterPanelOpen}
                      onActiveMediaSettled={() => setPreloadUnlockedIndex(index)}
                      onHideChrome={hideChrome}
                      onToggleChrome={toggleChromeHidden}
                      getPlaybackPosition={(mediaId) => playbackPositionsRef.current.get(mediaId) ?? 0}
                      onPlaybackPositionChange={(mediaId, currentTime) => {
                        playbackPositionsRef.current.set(mediaId, currentTime)
                      }}
                    />
                  ) : (
                    <Placeholder />
                  )}
                </div>
              </SwiperSlide>
            )
          })}

          {/* 如果没有更多数据，显示结束提示 */}
          {!hasMore && initialImages.length > 0 && (
            <SwiperSlide className="flex items-center justify-center text-white">
              <ViewerEndSurface active={atEnd && !controlsLocked} onToggleChrome={toggleChromeHidden} />
            </SwiperSlide>
          )}
        </Swiper>
        {autoWait === 'page' && autoStatus === 'running' && !pageFailed && !loadMoreError && (
          <div
            role="status"
            className="pointer-events-none absolute inset-x-4 top-20 z-40 rounded-lg bg-background p-3 text-sm text-foreground shadow-lg"
          >
            正在加载下一页…
          </div>
        )}
        {(pageFailed || loadMoreError) && (
          <div
            role="status"
            data-viewer-control
            className="absolute inset-x-4 top-20 z-40 flex flex-col gap-2 rounded-lg bg-background p-3 text-foreground shadow-lg"
          >
            <span className="text-sm">
              {autoStatus === 'paused' ? '下一页加载失败，自动浏览已暂停。' : '下一页加载失败。'}
            </span>
            <Button variant="outline" className="min-h-11" disabled={isLoading} onClick={() => void requestMore()}>
              重试加载
            </Button>
          </div>
        )}
        {reading.invalidated ? (
          <div
            className="absolute inset-x-4 top-16 z-40 flex items-center justify-between gap-3 rounded-lg bg-background p-3 text-sm text-foreground shadow-lg"
            role="status"
          >
            <span>作品媒体已更新，请重新打开阅读。</span>
            <Button type="button" size="sm" variant="outline" onClick={() => void reading.reopen()}>
              重新打开
            </Button>
          </div>
        ) : null}
        <Button
          type="button"
          variant="secondary"
          size="sm"
          aria-label={isChromeHidden ? '显示界面' : '隐藏界面'}
          aria-pressed={isChromeHidden}
          disabled={controlsLocked}
          onClick={toggleChromeHidden}
          className="sr-only focus-visible:not-sr-only focus-visible:absolute focus-visible:left-16 focus-visible:top-[max(0.75rem,env(safe-area-inset-top))] focus-visible:z-50"
        >
          {isChromeHidden ? '显示界面' : '隐藏界面'}
        </Button>
      </div>
    </div>
  )
}
