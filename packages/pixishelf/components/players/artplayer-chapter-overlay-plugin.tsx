'use client'

import { XIcon } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { ReactNode, SyntheticEvent } from 'react'
import type Artplayer from 'artplayer'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { NormalizedChapter } from './video-chapters'
import type { NormalizedVideoKeyframe } from './video-keyframes'
import { VideoNavigationBody, VideoNavigationHeader, type VideoNavigationTab } from './video-navigation-content'

export const CHAPTER_OVERLAY_PLUGIN_NAME = 'pixishelfChapterOverlay' as const

const CHAPTER_OVERLAY_LAYER_NAME = 'pixishelf-chapter-overlay'
const CHAPTER_OVERLAY_OPEN_CLASS = 'pixishelf-chapter-overlay-open'
const CHAPTER_RAIL_OPEN_CLASS = 'pixishelf-chapter-rail-open'
const CHAPTER_OVERLAY_HISTORY_KEY = '__pixishelf_chapter_overlay__'
const CLOSE_ANIMATION_DURATION_MS = 220

export type ChapterOverlayMode = 'desktop' | 'mobile-fullweb' | 'mobile-sheet'

export interface ChapterOverlaySnapshot {
  chapters: NormalizedChapter[]
  chaptersAvailable: boolean
  chapterCount: number
  chaptersLoading: boolean
  chaptersError: string | null
  onChaptersRetry: () => void
  currentChapterId?: string
  keyframes: NormalizedVideoKeyframe[]
  keyframesAvailable: boolean
  keyframeCount: number
  keyframesLoading: boolean
  keyframesError: string | null
  onKeyframesRetry: () => void
  onKeyframesOpen: () => void
  currentKeyframeId?: string
  mode: ChapterOverlayMode
}

export interface ChapterOverlayPluginApi {
  name: typeof CHAPTER_OVERLAY_PLUGIN_NAME
  update(snapshot: ChapterOverlaySnapshot): void
  show(): void
  hide(): void
  toggle(): void
  readonly visible: boolean
  destroy(): void
}

export interface ChapterOverlayPortal {
  target: HTMLElement
  content: ReactNode
}

interface ChapterOverlayViewProps extends ChapterOverlaySnapshot {
  visible: boolean
  activeTab: VideoNavigationTab
  onClose: () => void
  onTabChange: (tab: VideoNavigationTab) => void
  onChapterClick: (chapter: NormalizedChapter) => void
  onKeyframeClick: (keyframe: NormalizedVideoKeyframe) => void
}

function stopOverlayEvent(event: SyntheticEvent) {
  event.stopPropagation()
}

function ChapterOverlayView({
  chapters,
  chaptersAvailable,
  chapterCount,
  chaptersLoading,
  chaptersError,
  onChaptersRetry,
  currentChapterId,
  keyframes,
  keyframesAvailable,
  keyframeCount,
  keyframesLoading,
  keyframesError,
  onKeyframesRetry,
  currentKeyframeId,
  mode,
  visible,
  activeTab,
  onClose,
  onTabChange,
  onChapterClick,
  onKeyframeClick
}: ChapterOverlayViewProps) {
  const prefersReducedMotion = useReducedMotion()
  const navigationLabel =
    chaptersAvailable && keyframesAvailable ? '视频导航' : keyframesAvailable ? '视频画面' : '视频章节'
  const closeLabel = keyframesAvailable && !chaptersAvailable ? '关闭画面列表' : '关闭章节列表'
  const header = (
    <VideoNavigationHeader
      activeTab={activeTab}
      onTabChange={onTabChange}
      chaptersAvailable={chaptersAvailable}
      chapterCount={chapterCount}
      keyframesAvailable={keyframesAvailable}
      keyframeCount={keyframeCount}
      compact={mode !== 'mobile-sheet'}
    />
  )
  const body = (layout: 'grid' | 'horizontal', horizontalCardClassName?: string) => (
    <VideoNavigationBody
      activeTab={activeTab}
      chapters={chapters}
      chaptersLoading={chaptersLoading}
      chaptersError={chaptersError}
      onChaptersRetry={onChaptersRetry}
      currentChapterId={currentChapterId}
      onChapterClick={onChapterClick}
      keyframes={keyframes}
      keyframesLoading={keyframesLoading}
      keyframesError={keyframesError}
      onKeyframesRetry={onKeyframesRetry}
      currentKeyframeId={currentKeyframeId}
      onKeyframeClick={onKeyframeClick}
      layout={layout}
      className="h-full rounded-none border-none bg-transparent"
      scrollAreaClassName={layout === 'grid' ? 'h-full' : undefined}
      horizontalCardClassName={horizontalCardClassName}
    />
  )

  if (mode === 'desktop') {
    return (
      <AnimatePresence>
        {visible && (
          <motion.div
            key="desktop-chapter-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-auto absolute inset-0"
            role="dialog"
            aria-modal="true"
            aria-label={navigationLabel}
            onClick={stopOverlayEvent}
            onDoubleClick={stopOverlayEvent}
            onPointerDown={stopOverlayEvent}
            onPointerMove={stopOverlayEvent}
            onContextMenu={stopOverlayEvent}
          >
            <button
              type="button"
              aria-label={closeLabel}
              className="absolute inset-0 cursor-default border-0 bg-black/25 p-0"
              onClick={onClose}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="absolute bottom-0 right-0 top-0 flex max-w-full flex-col border-l border-white/10 bg-black/92 shadow-2xl backdrop-blur-xl"
              style={{ width: 'min(480px, 42vw)' }}
            >
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                {header}
                <button
                  type="button"
                  onClick={onClose}
                  aria-label={closeLabel}
                  data-chapter-overlay-close
                  className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">{body('grid')}</div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    )
  }

  if (mode === 'mobile-sheet') {
    return (
      <Sheet open={visible} onOpenChange={(open) => !open && onClose()}>
        <SheetContent
          side="bottom"
          aria-label={navigationLabel}
          aria-describedby={undefined}
          closeLabel={closeLabel}
          overlayClassName="z-[200] bg-black/60"
          className="pixishelf-chapter-sheet z-[200] overflow-hidden rounded-t-2xl border-white/10 bg-neutral-950 px-0 pb-[env(safe-area-inset-bottom)] text-white shadow-2xl [&>button]:right-4 [&>button]:top-4 [&>button]:text-white/75"
          onClick={stopOverlayEvent}
          onDoubleClick={stopOverlayEvent}
          onPointerDown={stopOverlayEvent}
          onPointerMove={stopOverlayEvent}
          onContextMenu={stopOverlayEvent}
        >
          <SheetHeader className="min-h-14 shrink-0 justify-center border-b border-white/10 px-4 py-2 text-left">
            <SheetTitle className="pr-10 text-base text-white">{header}</SheetTitle>
          </SheetHeader>
          <div className="min-h-0 flex-1 overflow-hidden">{body('grid')}</div>
        </SheetContent>
      </Sheet>
    )
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="mobile-fullweb-chapter-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
          className="pointer-events-none absolute inset-0 text-white"
          role="dialog"
          aria-modal="false"
          aria-label={navigationLabel}
          onClick={stopOverlayEvent}
          onDoubleClick={stopOverlayEvent}
          onPointerDown={stopOverlayEvent}
          onPointerMove={stopOverlayEvent}
          onContextMenu={stopOverlayEvent}
        >
          <button
            type="button"
            aria-label={keyframesAvailable && !chaptersAvailable ? '关闭画面列表并返回视频' : '关闭章节列表并返回视频'}
            className="pointer-events-auto absolute inset-x-0 top-0 border-0 bg-transparent p-0"
            style={{ bottom: 'var(--pixishelf-chapter-rail-height)' }}
            onClick={onClose}
          />
          <motion.section
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.22, ease: [0.2, 0.8, 0.2, 1] }}
            className="pointer-events-auto absolute inset-x-0 bottom-0 flex flex-col border-t border-white/10 bg-black/95 pb-[env(safe-area-inset-bottom)] shadow-[0_-18px_48px_rgba(0,0,0,0.45)] backdrop-blur-xl"
            style={{ height: 'var(--pixishelf-chapter-rail-height)' }}
          >
            <div className="flex min-h-11 shrink-0 items-center justify-between px-3">
              {header}
              <button
                type="button"
                onClick={onClose}
                aria-label={closeLabel}
                data-chapter-overlay-close
                className="rounded-full bg-white/10 p-2 text-white/75 active:bg-white/20"
              >
                <XIcon className="h-4 w-4" />
              </button>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              {body('horizontal')}
              <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-black/95 to-transparent"
              />
            </div>
          </motion.section>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function hasLayer(art: Artplayer): boolean {
  return Boolean((art.layers as Artplayer['layers'] & Record<string, unknown>)[CHAPTER_OVERLAY_LAYER_NAME])
}

function isMobileMode(mode: ChapterOverlayMode | null): mode is Exclude<ChapterOverlayMode, 'desktop'> {
  return mode === 'mobile-fullweb' || mode === 'mobile-sheet'
}

function asHistoryRecord(state: unknown): Record<string, unknown> {
  return typeof state === 'object' && state !== null && !Array.isArray(state) ? (state as Record<string, unknown>) : {}
}

function hasVideoNavigation(snapshot: ChapterOverlaySnapshot) {
  return snapshot.chaptersAvailable || snapshot.keyframesAvailable
}

function getAvailableNavigationTab(
  snapshot: ChapterOverlaySnapshot,
  preferred: VideoNavigationTab
): VideoNavigationTab {
  if (preferred === 'chapters' && snapshot.chaptersAvailable) return 'chapters'
  if (preferred === 'keyframes' && snapshot.keyframesAvailable) return 'keyframes'
  return snapshot.chaptersAvailable ? 'chapters' : 'keyframes'
}

export function createChapterOverlayPlugin(renderPortal: (portal: ChapterOverlayPortal) => void) {
  return (art: Artplayer): ChapterOverlayPluginApi => {
    let snapshot: ChapterOverlaySnapshot = {
      chapters: [],
      chaptersAvailable: false,
      chapterCount: 0,
      chaptersLoading: false,
      chaptersError: null,
      onChaptersRetry: () => undefined,
      currentChapterId: undefined,
      keyframes: [],
      keyframesAvailable: false,
      keyframeCount: 0,
      keyframesLoading: false,
      keyframesError: null,
      onKeyframesRetry: () => undefined,
      onKeyframesOpen: () => undefined,
      currentKeyframeId: undefined,
      mode: 'desktop'
    }
    let activeTab: VideoNavigationTab = 'chapters'
    let layerElement: HTMLElement | null = null
    let visible = false
    let destroyed = false
    let activeMode: ChapterOverlayMode | null = null
    let previousFocusedElement: HTMLElement | null = null
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    let focusTimer: ReturnType<typeof setTimeout> | null = null
    let historyClosePending = false

    const playerElement = art.template.$player
    const historyToken =
      typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`
    const blockedEvents = ['pointerdown', 'pointermove', 'pointerup', 'click', 'dblclick', 'contextmenu'] as const
    const stopPlayerEvent = (event: Event) => event.stopPropagation()

    const clearCloseTimer = () => {
      if (closeTimer) {
        clearTimeout(closeTimer)
        closeTimer = null
      }
    }

    const clearFocusTimer = () => {
      if (focusTimer) {
        clearTimeout(focusTimer)
        focusTimer = null
      }
    }

    const isCurrentHistoryEntry = (state: unknown = history.state) =>
      asHistoryRecord(state)[CHAPTER_OVERLAY_HISTORY_KEY] === historyToken

    const pushHistoryEntry = () => {
      if (historyClosePending || isCurrentHistoryEntry()) return

      history.pushState(
        { ...asHistoryRecord(history.state), [CHAPTER_OVERLAY_HISTORY_KEY]: historyToken },
        '',
        window.location.href
      )
    }

    const consumeHistoryEntry = () => {
      if (!isCurrentHistoryEntry()) return
      historyClosePending = true
      history.back()
    }

    const acquireModeEffects = (mode: ChapterOverlayMode) => {
      activeMode = mode
      playerElement.classList.toggle(CHAPTER_RAIL_OPEN_CLASS, mode === 'mobile-fullweb')
      if (isMobileMode(mode)) pushHistoryEntry()
    }

    const releaseModeEffects = (syncHistory: boolean) => {
      playerElement.classList.remove(CHAPTER_RAIL_OPEN_CLASS)
      if (syncHistory && isMobileMode(activeMode)) consumeHistoryEntry()
      activeMode = null
    }

    const updateModeEffects = (nextMode: ChapterOverlayMode) => {
      const previousMode = activeMode
      playerElement.classList.toggle(CHAPTER_RAIL_OPEN_CLASS, nextMode === 'mobile-fullweb')

      if (!isMobileMode(previousMode) && isMobileMode(nextMode)) {
        pushHistoryEntry()
      } else if (isMobileMode(previousMode) && !isMobileMode(nextMode)) {
        consumeHistoryEntry()
      }

      activeMode = nextMode
    }

    const seekToChapter = (chapter: NormalizedChapter) => {
      const artDuration = Number.isFinite(art.duration) && art.duration > 0 ? art.duration : null
      art.currentTime = artDuration ? Math.min(Math.max(chapter.start, 0), artDuration) : Math.max(chapter.start, 0)
    }

    const seekToKeyframe = (keyframe: NormalizedVideoKeyframe) => {
      const artDuration = Number.isFinite(art.duration) && art.duration > 0 ? art.duration : null
      art.currentTime = artDuration
        ? Math.min(Math.max(keyframe.captureTime, 0), artDuration)
        : Math.max(keyframe.captureTime, 0)
    }

    const selectTab = (tab: VideoNavigationTab) => {
      activeTab = getAvailableNavigationTab(snapshot, tab)
      if (activeTab === 'keyframes') snapshot.onKeyframesOpen()
      render()
    }

    const render = () => {
      if (!layerElement || destroyed) return
      renderPortal({
        target: layerElement,
        content: (
          <ChapterOverlayView
            {...snapshot}
            visible={visible}
            activeTab={activeTab}
            onClose={() => api.hide()}
            onTabChange={selectTab}
            onChapterClick={seekToChapter}
            onKeyframeClick={seekToKeyframe}
          />
        )
      })
    }

    const focusCloseButton = () => {
      clearFocusTimer()
      focusTimer = setTimeout(() => {
        focusTimer = null
        layerElement?.querySelector<HTMLButtonElement>('[data-chapter-overlay-close]')?.focus()
      }, 0)
    }

    const restoreFocus = () => {
      const target = previousFocusedElement
      previousFocusedElement = null
      if (target?.isConnected) target.focus()
    }

    const removeOpenClassAfterExit = () => {
      clearCloseTimer()
      closeTimer = setTimeout(() => {
        closeTimer = null
        if (!visible) playerElement.classList.remove(CHAPTER_OVERLAY_OPEN_CLASS)
      }, CLOSE_ANIMATION_DURATION_MS)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (visible && event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        api.hide()
      }
    }

    const handlePopState = (event: PopStateEvent) => {
      if (historyClosePending) {
        historyClosePending = false
        if (visible && isMobileMode(activeMode)) pushHistoryEntry()
        return
      }

      if (visible && isMobileMode(activeMode) && !isCurrentHistoryEntry(event.state)) {
        api.hide()
      }
    }

    const api: ChapterOverlayPluginApi = {
      name: CHAPTER_OVERLAY_PLUGIN_NAME,
      update(nextSnapshot) {
        if (destroyed) return

        const previousMode = snapshot.mode
        snapshot = nextSnapshot
        activeTab = getAvailableNavigationTab(snapshot, activeTab)

        if (!hasVideoNavigation(snapshot)) {
          api.hide()
          render()
          return
        }

        if (visible && previousMode !== snapshot.mode) {
          updateModeEffects(snapshot.mode)
        }

        render()
      },
      show() {
        if (destroyed || visible || !hasVideoNavigation(snapshot)) return

        clearCloseTimer()
        activeTab = getAvailableNavigationTab(snapshot, activeTab)
        if (activeTab === 'keyframes') snapshot.onKeyframesOpen()
        previousFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null
        visible = true
        playerElement.classList.add(CHAPTER_OVERLAY_OPEN_CLASS)
        acquireModeEffects(snapshot.mode)
        render()
        focusCloseButton()
      },
      hide() {
        if (destroyed || !visible) return

        clearFocusTimer()
        visible = false
        releaseModeEffects(true)
        render()
        restoreFocus()
        removeOpenClassAfterExit()
      },
      toggle() {
        if (visible) api.hide()
        else api.show()
      },
      get visible() {
        return visible
      },
      destroy() {
        if (destroyed) return

        destroyed = true
        visible = false
        clearCloseTimer()
        clearFocusTimer()
        releaseModeEffects(true)
        previousFocusedElement = null
        playerElement.classList.remove(CHAPTER_OVERLAY_OPEN_CLASS)
        playerElement.classList.remove(CHAPTER_RAIL_OPEN_CLASS)
        document.removeEventListener('keydown', handleKeyDown, true)
        window.removeEventListener('popstate', handlePopState)
        blockedEvents.forEach((eventName) => layerElement?.removeEventListener(eventName, stopPlayerEvent))

        if (hasLayer(art)) {
          art.layers.remove(CHAPTER_OVERLAY_LAYER_NAME)
        } else {
          layerElement = null
        }
      }
    }

    art.layers.add({
      name: CHAPTER_OVERLAY_LAYER_NAME,
      html: '',
      style: {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      },
      mounted(element) {
        layerElement = element
        blockedEvents.forEach((eventName) => element.addEventListener(eventName, stopPlayerEvent))
        render()
      },
      beforeUnmount(element) {
        blockedEvents.forEach((eventName) => element.removeEventListener(eventName, stopPlayerEvent))
        layerElement = null
      }
    })

    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('popstate', handlePopState)
    return api
  }
}

export function getChapterOverlayPlugin(art: Artplayer): ChapterOverlayPluginApi | null {
  const plugin = (art.plugins as Artplayer['plugins'] & Record<string, unknown>)[CHAPTER_OVERLAY_PLUGIN_NAME]
  return plugin && typeof plugin === 'object' ? (plugin as ChapterOverlayPluginApi) : null
}
