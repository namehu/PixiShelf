'use client'

import type Artplayer from 'artplayer'
import type { NormalizedChapter } from './video-chapters'
import {
  VIDEO_FEEDBACK_DURATION_MS,
  VIDEO_LONG_PRESS_DELAY_MS,
  VIDEO_MOVE_THRESHOLD_PX,
  VIDEO_TAP_DELAY_MS,
  formatInteractionTime,
  getDoubleTapAction,
  getGestureSeekTarget,
  type VideoInteractionFeedback
} from './video-interaction-core'

const HORIZONTAL_DIRECTION_RATIO = 1.25
const PROGRESS_DRAG_THRESHOLD_PX = 4

export {
  formatInteractionTime,
  getDoubleTapAction,
  getGestureSeekTarget,
  getGestureSeekWindow
} from './video-interaction-core'
export type { VideoInteractionFeedback, VideoInteractionFeedbackKind } from './video-interaction-core'

export interface VideoInteractionControllerOptions {
  longPressRate: 2 | 3
  seekStepSeconds: 5 | 10 | 15
  getChapterAt: (time: number) => NormalizedChapter | undefined
  onFeedback: (feedback: VideoInteractionFeedback | null) => void
  setControlsVisible: (visible: boolean) => void
  getControlsVisible: () => boolean
}

export interface VideoInteractionPluginApi {
  name: 'pixishelfVideoInteraction'
  destroy: () => void
}

interface ActivePointer {
  id: number
  pointerType: string
  startX: number
  startY: number
  startTime: number
  wasPlaying: boolean
  startPlaybackRate: number
  secondTap: boolean
  mode: 'pending' | 'scrubbing' | 'long-press' | 'vertical'
  targetTime: number
}

interface ProgressDragState {
  input: 'mouse' | 'touch'
  startX: number
  targetTime: number
  wasPlaying: boolean
  dragging: boolean
}

function stopNativeEvent(event: Event) {
  event.preventDefault()
  event.stopPropagation()
  event.stopImmediatePropagation()
}

function getProgressTarget(progress: HTMLElement, clientX: number, duration: number) {
  const rect = progress.getBoundingClientRect()
  const width = rect.width || progress.clientWidth
  if (width <= 0 || duration <= 0) return 0
  const ratio = Math.min(Math.max((clientX - rect.left) / width, 0), 1)
  return ratio * duration
}

function getTouchClientX(event: TouchEvent) {
  return event.touches[0]?.clientX ?? event.changedTouches[0]?.clientX ?? 0
}

export function createVideoInteractionPlugin(options: VideoInteractionControllerOptions) {
  return (art: Artplayer): VideoInteractionPluginApi => {
    const cleanup: Array<() => void> = []
    const surface = document.createElement('div')
    surface.className = 'pixishelf-video-gesture-surface'
    surface.style.position = 'absolute'
    surface.style.inset = '0'
    surface.style.pointerEvents = 'auto'
    surface.style.touchAction = 'pan-y pinch-zoom'
    surface.style.userSelect = 'none'
    surface.style.webkitUserSelect = 'none'
    surface.setAttribute('aria-label', '视频手势区域')

    let activePointer: ActivePointer | null = null
    let progressDrag: ProgressDragState | null = null
    let longPressTimer: ReturnType<typeof setTimeout> | null = null
    let singleTapTimer: ReturnType<typeof setTimeout> | null = null
    let feedbackTimer: ReturnType<typeof setTimeout> | null = null
    let suppressProgressClick = false
    let destroyed = false

    const clearLongPressTimer = () => {
      if (!longPressTimer) return
      clearTimeout(longPressTimer)
      longPressTimer = null
    }

    const clearSingleTapTimer = () => {
      if (!singleTapTimer) return
      clearTimeout(singleTapTimer)
      singleTapTimer = null
    }

    const clearFeedbackTimer = () => {
      if (!feedbackTimer) return
      clearTimeout(feedbackTimer)
      feedbackTimer = null
    }

    const showFeedback = (feedback: VideoInteractionFeedback, duration = VIDEO_FEEDBACK_DURATION_MS) => {
      clearFeedbackTimer()
      options.onFeedback(feedback)
      if (feedback.persistent) return
      feedbackTimer = setTimeout(() => {
        feedbackTimer = null
        options.onFeedback(null)
      }, duration)
    }

    const clearFeedback = () => {
      clearFeedbackTimer()
      options.onFeedback(null)
    }

    const getDuration = () => (Number.isFinite(art.duration) && art.duration > 0 ? art.duration : 0)
    const getPlaybackRate = () => art.template.$video?.playbackRate || art.playbackRate || 1
    const setPlaybackRate = (rate: number) => {
      if (art.template.$video) art.template.$video.playbackRate = rate
      else art.playbackRate = rate
    }
    const clampTime = (time: number) => {
      const duration = getDuration()
      return duration > 0 ? Math.min(Math.max(time, 0), duration) : Math.max(time, 0)
    }

    const previewSeek = (time: number, event?: Event) => {
      const duration = getDuration()
      if (duration <= 0) return
      art.emit('setBar', 'played', Math.min(Math.max(time / duration, 0), 1), event)
    }

    const restoreProgress = (event?: Event) => previewSeek(art.currentTime, event)

    const commitSeek = (time: number) => {
      const nextTime = clampTime(time)
      art.currentTime = nextTime
      return nextTime
    }

    const resumeIfNeeded = (wasPlaying: boolean) => {
      if (!wasPlaying || destroyed) return
      void art.play().catch(() => undefined)
    }

    const pauseIfNeeded = (wasPlaying: boolean) => {
      if (wasPlaying) art.pause()
    }

    const describeTarget = (targetTime: number, startTime: number) => {
      const delta = Math.round(targetTime - startTime)
      const chapter = options.getChapterAt(targetTime)
      return {
        title: `目标 ${formatInteractionTime(targetTime)}`,
        detail: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)} 秒${chapter ? ` · ${chapter.title}` : ''}`
      }
    }

    const cancelActivePointer = ({ resume = true }: { resume?: boolean } = {}) => {
      clearLongPressTimer()
      const pointer = activePointer
      activePointer = null
      if (!pointer) return

      if (pointer.mode === 'long-press') {
        setPlaybackRate(pointer.startPlaybackRate)
      }
      if (pointer.mode === 'scrubbing') {
        restoreProgress()
        if (resume) resumeIfNeeded(pointer.wasPlaying)
      }
      clearFeedback()
    }

    const handleDoubleTap = (clientX: number) => {
      const action = getDoubleTapAction(clientX, surface.getBoundingClientRect())
      if (action === 'toggle-playback') {
        const wasPlaying = art.playing
        if (wasPlaying) art.pause()
        else void art.play().catch(() => undefined)
        showFeedback({ kind: 'playback', title: wasPlaying ? '暂停' : '播放' })
        return
      }

      const direction = action === 'backward' ? -1 : 1
      const nextTime = commitSeek(art.currentTime + direction * options.seekStepSeconds)
      showFeedback({
        kind: 'seek',
        title: `${direction < 0 ? '快退' : '快进'} ${options.seekStepSeconds} 秒`,
        detail: formatInteractionTime(nextTime)
      })
    }

    const handleTap = () => {
      singleTapTimer = setTimeout(() => {
        singleTapTimer = null
        options.setControlsVisible(!options.getControlsVisible())
      }, VIDEO_TAP_DELAY_MS)
    }

    const onPointerDown = (event: PointerEvent) => {
      if (
        destroyed ||
        activePointer ||
        event.isPrimary === false ||
        (event.pointerType === 'mouse' && event.button !== 0)
      ) {
        return
      }

      const secondTap = Boolean(singleTapTimer)
      if (secondTap) clearSingleTapTimer()

      activePointer = {
        id: event.pointerId,
        pointerType: event.pointerType,
        startX: event.clientX,
        startY: event.clientY,
        startTime: art.currentTime,
        wasPlaying: art.playing,
        startPlaybackRate: getPlaybackRate(),
        secondTap,
        mode: 'pending',
        targetTime: art.currentTime
      }

      if (event.pointerType === 'touch' && art.playing) {
        longPressTimer = setTimeout(() => {
          const pointer = activePointer
          if (!pointer || pointer.mode !== 'pending') return
          pointer.mode = 'long-press'
          setPlaybackRate(options.longPressRate)
          showFeedback({ kind: 'rate', title: `${options.longPressRate}× 快进中`, persistent: true })
        }, VIDEO_LONG_PRESS_DELAY_MS)
      }
    }

    const onPointerMove = (event: PointerEvent) => {
      const pointer = activePointer
      if (!pointer || pointer.id !== event.pointerId) return

      const deltaX = event.clientX - pointer.startX
      const deltaY = event.clientY - pointer.startY
      const absX = Math.abs(deltaX)
      const absY = Math.abs(deltaY)

      if (pointer.mode === 'long-press') {
        if (Math.max(absX, absY) >= VIDEO_MOVE_THRESHOLD_PX) {
          setPlaybackRate(pointer.startPlaybackRate)
          pointer.mode = 'vertical'
          clearFeedback()
        }
        return
      }

      if (pointer.mode === 'pending' && Math.max(absX, absY) >= VIDEO_MOVE_THRESHOLD_PX) {
        clearLongPressTimer()
        if (pointer.pointerType === 'touch' && absX > absY * HORIZONTAL_DIRECTION_RATIO) {
          pointer.mode = 'scrubbing'
          pauseIfNeeded(pointer.wasPlaying)
          surface.setPointerCapture?.(event.pointerId)
        } else {
          pointer.mode = 'vertical'
        }
      }

      if (pointer.mode !== 'scrubbing') return
      event.preventDefault()
      const targetTime = getGestureSeekTarget({
        startTime: pointer.startTime,
        duration: getDuration(),
        deltaX,
        width: surface.getBoundingClientRect().width
      })
      pointer.targetTime = targetTime
      previewSeek(targetTime, event)
      const description = describeTarget(targetTime, pointer.startTime)
      showFeedback({ kind: 'scrub', ...description, persistent: true })
    }

    const finishActivePointer = (event: PointerEvent) => {
      const pointer = activePointer
      if (!pointer || pointer.id !== event.pointerId) return
      clearLongPressTimer()
      activePointer = null

      if (pointer.mode === 'long-press') {
        setPlaybackRate(pointer.startPlaybackRate)
        showFeedback({ kind: 'rate', title: `恢复 ${pointer.startPlaybackRate}×` })
        return
      }

      if (pointer.mode === 'scrubbing') {
        event.preventDefault()
        const nextTime = commitSeek(pointer.targetTime)
        resumeIfNeeded(pointer.wasPlaying)
        const description = describeTarget(nextTime, pointer.startTime)
        showFeedback({ kind: 'scrub', ...description })
        return
      }

      if (pointer.mode === 'pending') {
        if (pointer.secondTap) handleDoubleTap(event.clientX)
        else handleTap()
      }
    }

    const onPointerCancel = () => cancelActivePointer()

    surface.addEventListener('pointerdown', onPointerDown)
    surface.addEventListener('pointermove', onPointerMove)
    surface.addEventListener('pointerup', finishActivePointer)
    surface.addEventListener('pointercancel', onPointerCancel)
    surface.addEventListener('contextmenu', stopNativeEvent)
    cleanup.push(() => {
      surface.removeEventListener('pointerdown', onPointerDown)
      surface.removeEventListener('pointermove', onPointerMove)
      surface.removeEventListener('pointerup', finishActivePointer)
      surface.removeEventListener('pointercancel', onPointerCancel)
      surface.removeEventListener('contextmenu', stopNativeEvent)
    })

    const progress = art.template.$progress
    const beginProgressDrag = (input: 'mouse' | 'touch', clientX: number, event: Event) => {
      if ((event.target as Element | null)?.closest('button')) return
      stopNativeEvent(event)
      progressDrag = {
        input,
        startX: clientX,
        targetTime: getProgressTarget(progress, clientX, getDuration()),
        wasPlaying: art.playing,
        dragging: false
      }
    }

    const updateProgressDrag = (clientX: number, event: Event) => {
      const drag = progressDrag
      if (!drag) return
      stopNativeEvent(event)
      if (!drag.dragging && Math.abs(clientX - drag.startX) >= PROGRESS_DRAG_THRESHOLD_PX) {
        drag.dragging = true
        pauseIfNeeded(drag.wasPlaying)
      }
      if (!drag.dragging) return
      drag.targetTime = getProgressTarget(progress, clientX, getDuration())
      previewSeek(drag.targetTime, event)
      showFeedback({
        kind: 'scrub',
        title: `目标 ${formatInteractionTime(drag.targetTime)}`,
        detail: options.getChapterAt(drag.targetTime)?.title,
        persistent: true
      })
    }

    const finishProgressDrag = (clientX: number, event: Event) => {
      const drag = progressDrag
      if (!drag) return
      stopNativeEvent(event)
      progressDrag = null
      suppressProgressClick = true
      drag.targetTime = getProgressTarget(progress, clientX, getDuration())
      const nextTime = commitSeek(drag.targetTime)
      resumeIfNeeded(drag.wasPlaying && drag.dragging)
      showFeedback({
        kind: 'scrub',
        title: `目标 ${formatInteractionTime(nextTime)}`,
        detail: options.getChapterAt(nextTime)?.title
      })
    }

    const cancelProgressDrag = () => {
      const drag = progressDrag
      progressDrag = null
      if (!drag) return
      restoreProgress()
      resumeIfNeeded(drag.wasPlaying && drag.dragging)
      clearFeedback()
    }

    const onProgressMouseDown = (event: MouseEvent) => {
      if (event.button === 0) beginProgressDrag('mouse', event.clientX, event)
    }
    const onProgressTouchStart = (event: TouchEvent) => beginProgressDrag('touch', getTouchClientX(event), event)
    const onDocumentMouseMove = (event: MouseEvent) => {
      if (progressDrag?.input === 'mouse') updateProgressDrag(event.clientX, event)
    }
    const onDocumentTouchMove = (event: TouchEvent) => {
      if (progressDrag?.input === 'touch') updateProgressDrag(getTouchClientX(event), event)
    }
    const onDocumentMouseUp = (event: MouseEvent) => {
      if (progressDrag?.input === 'mouse') finishProgressDrag(event.clientX, event)
    }
    const onDocumentTouchEnd = (event: TouchEvent) => {
      if (progressDrag?.input === 'touch') finishProgressDrag(getTouchClientX(event), event)
    }
    const onProgressClick = (event: MouseEvent) => {
      if (!suppressProgressClick || (event.target as Element | null)?.closest('button')) return
      suppressProgressClick = false
      stopNativeEvent(event)
    }

    progress.addEventListener('mousedown', onProgressMouseDown, true)
    progress.addEventListener('touchstart', onProgressTouchStart, { capture: true, passive: false })
    progress.addEventListener('click', onProgressClick, true)
    document.addEventListener('mousemove', onDocumentMouseMove, true)
    document.addEventListener('touchmove', onDocumentTouchMove, { capture: true, passive: false })
    document.addEventListener('mouseup', onDocumentMouseUp, true)
    document.addEventListener('touchend', onDocumentTouchEnd, true)
    document.addEventListener('touchcancel', cancelProgressDrag, true)
    const onWindowBlur = () => {
      cancelActivePointer()
      cancelProgressDrag()
    }
    window.addEventListener('blur', onWindowBlur)
    cleanup.push(() => {
      progress.removeEventListener('mousedown', onProgressMouseDown, true)
      progress.removeEventListener('touchstart', onProgressTouchStart, true)
      progress.removeEventListener('click', onProgressClick, true)
      document.removeEventListener('mousemove', onDocumentMouseMove, true)
      document.removeEventListener('touchmove', onDocumentTouchMove, true)
      document.removeEventListener('mouseup', onDocumentMouseUp, true)
      document.removeEventListener('touchend', onDocumentTouchEnd, true)
      document.removeEventListener('touchcancel', cancelProgressDrag, true)
      window.removeEventListener('blur', onWindowBlur)
    })

    const onKeyDown = (event: KeyboardEvent) => {
      if (!art.isFocus || art.isInput || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return
      stopNativeEvent(event)
      const direction = event.key === 'ArrowLeft' ? -1 : 1
      const nextTime = commitSeek(art.currentTime + direction * options.seekStepSeconds)
      showFeedback({
        kind: 'seek',
        title: `${direction < 0 ? '快退' : '快进'} ${options.seekStepSeconds} 秒`,
        detail: formatInteractionTime(nextTime)
      })
    }
    document.addEventListener('keydown', onKeyDown, true)
    cleanup.push(() => document.removeEventListener('keydown', onKeyDown, true))

    art.layers.add({
      name: 'pixishelf-video-interaction',
      html: '',
      style: {
        position: 'absolute',
        inset: '0',
        width: '100%',
        height: '100%',
        pointerEvents: 'none'
      },
      mounted(element) {
        element.append(surface)
      },
      beforeUnmount() {
        surface.remove()
      }
    })

    return {
      name: 'pixishelfVideoInteraction',
      destroy() {
        if (destroyed) return
        destroyed = true
        cancelActivePointer({ resume: false })
        cancelProgressDrag()
        clearSingleTapTimer()
        clearFeedbackTimer()
        cleanup.splice(0).forEach((dispose) => dispose())
        if (art.layers['pixishelf-video-interaction']) {
          art.layers.remove('pixishelf-video-interaction')
        }
      }
    }
  }
}

export function getVideoInteractionPlugin(art: Artplayer): VideoInteractionPluginApi | null {
  const plugin = (art.plugins as Artplayer['plugins'] & Record<string, unknown>).pixishelfVideoInteraction
  return plugin && typeof plugin === 'object' ? (plugin as VideoInteractionPluginApi) : null
}
