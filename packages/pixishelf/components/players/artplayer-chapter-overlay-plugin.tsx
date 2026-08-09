'use client'

import { XIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import type { ReactNode, SyntheticEvent } from 'react'
import type Artplayer from 'artplayer'
import ChapterSidebar from './chapter-sidebar'
import type { NormalizedChapter } from './video-chapters'

export const CHAPTER_OVERLAY_PLUGIN_NAME = 'pixishelfChapterOverlay' as const

const CHAPTER_OVERLAY_LAYER_NAME = 'pixishelf-chapter-overlay'
const CHAPTER_OVERLAY_OPEN_CLASS = 'pixishelf-chapter-overlay-open'
const CLOSE_ANIMATION_DURATION_MS = 180

export type ChapterOverlayMode = 'desktop' | 'mobile'

export interface ChapterOverlaySnapshot {
  chapters: NormalizedChapter[]
  currentChapterId?: string
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
  onClose: () => void
  onChapterClick: (chapter: NormalizedChapter) => void
}

function stopOverlayEvent(event: SyntheticEvent) {
  event.stopPropagation()
}

function ChapterOverlayView({
  chapters,
  currentChapterId,
  mode,
  visible,
  onClose,
  onChapterClick
}: ChapterOverlayViewProps) {
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
            aria-label="视频章节"
            onClick={stopOverlayEvent}
            onDoubleClick={stopOverlayEvent}
            onPointerDown={stopOverlayEvent}
            onPointerMove={stopOverlayEvent}
            onContextMenu={stopOverlayEvent}
          >
            <button
              type="button"
              aria-label="关闭章节列表"
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
                <div>
                  <span className="font-medium text-white">章节</span>
                  <span className="ml-2 text-xs text-white/60">{chapters.length} 段</span>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="关闭章节列表"
                  data-chapter-overlay-close
                  className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-hidden">
                <ChapterSidebar
                  chapters={chapters}
                  currentChapterId={currentChapterId}
                  onChapterClick={onChapterClick}
                  tone="dark"
                  className="h-full rounded-none border-none bg-transparent"
                  scrollAreaClassName="h-full"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          key="mobile-chapter-overlay"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 16 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="pointer-events-auto fixed inset-0 flex flex-col bg-black text-white"
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
          role="dialog"
          aria-modal="true"
          aria-label="视频章节"
          onClick={stopOverlayEvent}
          onDoubleClick={stopOverlayEvent}
          onPointerDown={stopOverlayEvent}
          onPointerMove={stopOverlayEvent}
          onContextMenu={stopOverlayEvent}
        >
          <div className="flex min-h-14 shrink-0 items-center justify-between border-b border-white/10 px-4">
            <div>
              <span className="font-medium">章节</span>
              <span className="ml-2 text-xs text-white/60">{chapters.length} 段</span>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭章节列表"
              data-chapter-overlay-close
              className="rounded-full bg-white/10 p-2 text-white/75 active:bg-white/20"
            >
              <XIcon className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden">
            <ChapterSidebar
              chapters={chapters}
              currentChapterId={currentChapterId}
              onChapterClick={onChapterClick}
              tone="dark"
              className="h-full rounded-none border-none bg-transparent"
              scrollAreaClassName="h-full"
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function getArtVideo(art: Artplayer): HTMLVideoElement | null {
  const currentArt = art as Artplayer & { video?: HTMLVideoElement; template?: { $video?: HTMLVideoElement } }
  return currentArt.video ?? currentArt.template?.$video ?? null
}

function hasLayer(art: Artplayer): boolean {
  return Boolean((art.layers as Artplayer['layers'] & Record<string, unknown>)[CHAPTER_OVERLAY_LAYER_NAME])
}

export function createChapterOverlayPlugin(renderPortal: (portal: ChapterOverlayPortal) => void) {
  return (art: Artplayer): ChapterOverlayPluginApi => {
    let snapshot: ChapterOverlaySnapshot = {
      chapters: [],
      currentChapterId: undefined,
      mode: 'desktop'
    }
    let layerElement: HTMLElement | null = null
    let visible = false
    let destroyed = false
    let activeMode: ChapterOverlayMode | null = null
    let mobileWasPlaying = false
    let previousBodyOverflow: string | null = null
    let previousFocusedElement: HTMLElement | null = null
    let closeTimer: ReturnType<typeof setTimeout> | null = null
    let focusTimer: ReturnType<typeof setTimeout> | null = null

    const playerElement = art.template.$player
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

    const restoreBodyOverflow = () => {
      if (previousBodyOverflow === null) return
      document.body.style.overflow = previousBodyOverflow
      previousBodyOverflow = null
    }

    const acquireModeEffects = (mode: ChapterOverlayMode) => {
      activeMode = mode
      if (mode !== 'mobile') return

      const video = getArtVideo(art)
      mobileWasPlaying = Boolean(video && !video.paused && !video.ended)
      if (mobileWasPlaying) video?.pause()

      previousBodyOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }

    const releaseModeEffects = (restorePlayback: boolean) => {
      restoreBodyOverflow()

      if (activeMode === 'mobile' && mobileWasPlaying && restorePlayback) {
        getArtVideo(art)?.play().catch(() => undefined)
      }

      mobileWasPlaying = false
      activeMode = null
    }

    const seekToChapter = (chapter: NormalizedChapter) => {
      const artDuration = Number.isFinite(art.duration) && art.duration > 0 ? art.duration : null
      art.currentTime = artDuration ? Math.min(Math.max(chapter.start, 0), artDuration) : Math.max(chapter.start, 0)

      if (snapshot.mode === 'mobile') {
        api.hide()
      }
    }

    const render = () => {
      if (!layerElement || destroyed) return
      renderPortal({
        target: layerElement,
        content: (
          <ChapterOverlayView
            {...snapshot}
            visible={visible}
            onClose={() => api.hide()}
            onChapterClick={seekToChapter}
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

    const api: ChapterOverlayPluginApi = {
      name: CHAPTER_OVERLAY_PLUGIN_NAME,
      update(nextSnapshot) {
        if (destroyed) return

        const previousMode = snapshot.mode
        snapshot = nextSnapshot

        if (snapshot.chapters.length === 0) {
          api.hide()
          render()
          return
        }

        if (visible && previousMode !== snapshot.mode) {
          releaseModeEffects(true)
          acquireModeEffects(snapshot.mode)
        }

        render()
      },
      show() {
        if (destroyed || visible || snapshot.chapters.length === 0) return

        clearCloseTimer()
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
        releaseModeEffects(false)
        previousFocusedElement = null
        playerElement.classList.remove(CHAPTER_OVERLAY_OPEN_CLASS)
        document.removeEventListener('keydown', handleKeyDown, true)
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
    return api
  }
}

export function getChapterOverlayPlugin(art: Artplayer): ChapterOverlayPluginApi | null {
  const plugin = (art.plugins as Artplayer['plugins'] & Record<string, unknown>)[CHAPTER_OVERLAY_PLUGIN_NAME]
  return plugin && typeof plugin === 'object' ? (plugin as ChapterOverlayPluginApi) : null
}
