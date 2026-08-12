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

const VIEWER_CHAPTER_HISTORY_KEY = '__pixishelf_viewer_chapters__'
const VIEWER_CLEAR_MODE_HISTORY_KEY = '__pixishelf_viewer_clear_mode__'

function asHistoryRecord(state: unknown): Record<string, unknown> {
  return typeof state === 'object' && state !== null && !Array.isArray(state)
    ? (state as Record<string, unknown>)
    : {}
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

export function useClearModeHistory(isChromeHidden: boolean, setChromeHidden: (hidden: boolean) => void) {
  const tokenRef = useRef<string | null>(null)
  const closePendingRef = useRef(false)

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
    (state: unknown = history.state) => asHistoryRecord(state)[VIEWER_CLEAR_MODE_HISTORY_KEY] === getToken(),
    [getToken]
  )

  const enterClearMode = useCallback(() => {
    if (isChromeHidden || typeof window === 'undefined') return
    history.pushState(
      { ...asHistoryRecord(history.state), [VIEWER_CLEAR_MODE_HISTORY_KEY]: getToken() },
      '',
      window.location.href
    )
    setChromeHidden(true)
  }, [getToken, isChromeHidden, setChromeHidden])

  const exitClearMode = useCallback(() => {
    if (!isChromeHidden) return
    if (typeof window !== 'undefined' && isCurrentEntry()) {
      closePendingRef.current = true
      history.back()
      return
    }
    setChromeHidden(false)
  }, [isChromeHidden, isCurrentEntry, setChromeHidden])

  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      if (closePendingRef.current) {
        closePendingRef.current = false
        setChromeHidden(false)
        return
      }
      if (isChromeHidden && !isCurrentEntry(event.state)) setChromeHidden(false)
    }
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [isChromeHidden, isCurrentEntry, setChromeHidden])

  return { enterClearMode, exitClearMode }
}

interface ImmersiveImageViewerProps {
  initialImages: RandomImageItem[]
  hasMore: boolean
  isLoading: boolean
  onLoadMore: () => void
  interactionLocked?: boolean
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
  interactionLocked = false
}: ImmersiveImageViewerProps) {
  const [audioPreference, setAudioPreference] = useState<ViewerAudioPreference>({ muted: true, volume: 1 })
  const [chapterPanelOpen, setChapterPanelOpen] = useChapterPanelHistory()
  const [preloadUnlockedIndex, setPreloadUnlockedIndex] = useState<number | null>(null)
  const [showClearHint, setShowClearHint] = useState(false)
  const playbackPositionsRef = useRef(new Map<number, number>())
  const { setVerticalIndex, verticalIndex, isChromeHidden, setChromeHidden } = useViewerStore(
    useShallow((state) => ({
      verticalIndex: state.verticalIndex,
      setVerticalIndex: state.setVerticalIndex,
      isChromeHidden: state.isChromeHidden,
      setChromeHidden: state.setChromeHidden
    }))
  )
  const { enterClearMode, exitClearMode } = useClearModeHistory(isChromeHidden, setChromeHidden)

  // 处理slide变化
  const handleSlideChange = useCallback(
    (swiper: SwiperType) => {
      setChapterPanelOpen(false)
      setPreloadUnlockedIndex(null)
      setVerticalIndex(swiper.activeIndex)
    },
    [setChapterPanelOpen, setVerticalIndex]
  )

  useEffect(() => {
    if (!isChromeHidden) {
      setShowClearHint(false)
      return
    }
    setShowClearHint(true)
    const timer = window.setTimeout(() => setShowClearHint(false), 1500)
    return () => window.clearTimeout(timer)
  }, [isChromeHidden])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const isInteractiveTarget = target?.closest(
        'button, input, select, textarea, [role="slider"], [role="dialog"], [data-viewer-control]'
      )

      if (chapterPanelOpen || target?.isContentEditable || isInteractiveTarget) {
        return
      }

      if (event.key.toLowerCase() === 'c') {
        event.preventDefault()
        if (isChromeHidden) exitClearMode()
        else enterClearMode()
      } else if (event.key === 'Escape' && isChromeHidden) {
        event.preventDefault()
        exitClearMode()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [chapterPanelOpen, enterClearMode, exitClearMode, isChromeHidden])

  return (
    // PC端适配容器
    <div className="w-full h-full bg-black md:flex md:items-center md:justify-center">
      {/* 沉浸式查看器主容器 */}
      <div className="immersive-container h-full w-full md:max-w-[420px] md:h-[90vh] md:aspect-[9/16] md:rounded-lg relative bg-neutral-900">
        <Swiper
          initialSlide={verticalIndex}
          direction="vertical"
          className="h-full w-full"
          allowTouchMove={!chapterPanelOpen && !interactionLocked}
          // PC配置
          mousewheel={{ enabled: !interactionLocked }}
          keyboard={{ enabled: !chapterPanelOpen && !interactionLocked }}
          modules={[Mousewheel, Keyboard]}
          // 初始索引配置
          slidesPerView={1}
          lazyPreloadPrevNext={0}
          resistance={true}
          resistanceRatio={0.85}
          speed={300}
          touchRatio={1}
          touchAngle={45}
          grabCursor={true}
          onReachEnd={() => {
            if (hasMore && !isLoading) {
              onLoadMore()
            }
          }}
          onSlideChange={handleSlideChange}
        >
          {initialImages.map((image, index) => {
            // 1. 判断当前幻灯片是否是用户正在看的
            const isActive = index === verticalIndex
            // 2. 判断当前幻灯片是否是需要预加载的（即下一个或上一个）
            const isPreloading = Math.abs(index - verticalIndex) === 1
            // 3. 只有“活动”和“预加载”的幻灯片才会被渲染，其他都是占位符
            const shouldRender = isActive || isPreloading

            return (
              <SwiperSlide key={image.key} className=" flex w-full h-ful items-center justify-center overflow-hidden">
                <div className="relative w-full h-full bg-black">
                  {shouldRender ? (
                    <ImageSlide
                      isActive={isActive}
                      preloadEntryMedia={index === verticalIndex + 1 && preloadUnlockedIndex === verticalIndex}
                      image={image}
                      audioPreference={audioPreference}
                      onAudioPreferenceChange={setAudioPreference}
                      chapterPanelOpen={chapterPanelOpen}
                      onChapterPanelOpenChange={setChapterPanelOpen}
                      onActiveMediaSettled={() => setPreloadUnlockedIndex(index)}
                      onEnterClearMode={enterClearMode}
                      onExitClearMode={exitClearMode}
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
              <div className="text-center">
                <p className="text-sm opacity-60">没有更多图片了</p>
              </div>
            </SwiperSlide>
          )}
        </Swiper>
        {showClearHint && (
          <div className="pointer-events-none absolute inset-0 z-[80] flex items-center justify-center">
            <div className="rounded-full bg-black/60 px-4 py-2 text-sm text-white backdrop-blur-sm">
              已清屏 · 单击恢复
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
