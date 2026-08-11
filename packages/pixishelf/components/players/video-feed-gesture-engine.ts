import {
  VIDEO_ACTION_LONG_PRESS_DELAY_MS,
  VIDEO_FEEDBACK_DURATION_MS,
  VIDEO_LONG_PRESS_DELAY_MS,
  VIDEO_MOVE_THRESHOLD_PX,
  VIDEO_TAP_DELAY_MS,
  formatInteractionTime,
  getDoubleTapZone,
  type VideoInteractionFeedback
} from './video-interaction-core'

export interface FeedGesturePoint {
  pointerId: number
  pointerType: string
  button?: number
  isPrimary?: boolean
  clientX: number
  clientY: number
}

export interface FeedGestureEngineOptions {
  mediaKind: 'image' | 'video'
  longPressRate: 2 | 3
  seekStepSeconds: 5 | 10 | 15
  getSurfaceRect: () => Pick<DOMRect, 'left' | 'width'>
  getPlaying: () => boolean
  getCurrentTime: () => number
  getDuration: () => number
  getPlaybackRate: () => number
  setPlaybackRate: (rate: number) => void
  onTogglePlayback: () => void
  onSeek: (time: number) => void
  onLike: (point: { x: number; y: number }) => void
  onOpenActions: () => void
  getChromeHidden: () => boolean
  onExitClearMode: () => void
  onFeedback: (feedback: VideoInteractionFeedback | null) => void
}

export interface FeedGestureEngine {
  pointerDown: (event: FeedGesturePoint) => void
  pointerMove: (event: FeedGesturePoint) => void
  pointerUp: (event: FeedGesturePoint) => void
  pointerCancel: () => void
  destroy: () => void
}

interface ActivePointer {
  id: number
  pointerType: string
  startX: number
  startY: number
  startPlaybackRate: number
  secondTap: boolean
  mode: 'pending' | 'moved' | 'rate' | 'actions'
}

export function createFeedGestureEngine(options: FeedGestureEngineOptions): FeedGestureEngine {
  let activePointer: ActivePointer | null = null
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let singleTapTimer: ReturnType<typeof setTimeout> | null = null
  let feedbackTimer: ReturnType<typeof setTimeout> | null = null
  let destroyed = false

  const clearLongPress = () => {
    if (!longPressTimer) return
    clearTimeout(longPressTimer)
    longPressTimer = null
  }
  const clearSingleTap = () => {
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
  const restoreRate = (pointer: ActivePointer) => {
    if (pointer.mode !== 'rate') return
    options.setPlaybackRate(pointer.startPlaybackRate)
  }
  const clampTime = (time: number) => {
    const duration = options.getDuration()
    return duration > 0 ? Math.min(Math.max(time, 0), duration) : Math.max(time, 0)
  }

  const handleSingleTap = () => {
    if (options.getChromeHidden()) {
      options.onExitClearMode()
      return
    }
    if (options.mediaKind !== 'video') return

    const wasPlaying = options.getPlaying()
    options.onTogglePlayback()
    showFeedback({ kind: 'playback', title: wasPlaying ? '暂停' : '播放' })
  }

  const handleDoubleTap = (event: FeedGesturePoint) => {
    if (options.mediaKind === 'image') {
      options.onLike({ x: event.clientX, y: event.clientY })
      return
    }

    const zone = getDoubleTapZone(event.clientX, options.getSurfaceRect())
    if (zone === 'middle') {
      options.onLike({ x: event.clientX, y: event.clientY })
      return
    }

    const direction = zone === 'backward' ? -1 : 1
    const nextTime = clampTime(options.getCurrentTime() + direction * options.seekStepSeconds)
    options.onSeek(nextTime)
    showFeedback({
      kind: 'seek',
      title: `${direction < 0 ? '快退' : '快进'} ${options.seekStepSeconds} 秒`,
      detail: formatInteractionTime(nextTime)
    })
  }

  const pointerDown = (event: FeedGesturePoint) => {
    if (
      destroyed ||
      activePointer ||
      event.isPrimary === false ||
      (event.pointerType === 'mouse' && event.button !== 0)
    ) {
      return
    }

    const secondTap = Boolean(singleTapTimer)
    if (secondTap) clearSingleTap()
    activePointer = {
      id: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      startPlaybackRate: options.getPlaybackRate(),
      secondTap,
      mode: 'pending'
    }

    if (!['touch', 'pen'].includes(event.pointerType)) return

    const shouldFastForward = options.mediaKind === 'video' && options.getPlaying()
    longPressTimer = setTimeout(
      () => {
        const pointer = activePointer
        if (!pointer || pointer.mode !== 'pending') return

        if (shouldFastForward) {
          pointer.mode = 'rate'
          options.setPlaybackRate(options.longPressRate)
          showFeedback({ kind: 'rate', title: `${options.longPressRate}× 快进中`, persistent: true })
          return
        }

        pointer.mode = 'actions'
        options.onOpenActions()
      },
      shouldFastForward ? VIDEO_LONG_PRESS_DELAY_MS : VIDEO_ACTION_LONG_PRESS_DELAY_MS
    )
  }

  const pointerMove = (event: FeedGesturePoint) => {
    const pointer = activePointer
    if (!pointer || pointer.id !== event.pointerId) return

    const moved = Math.max(Math.abs(event.clientX - pointer.startX), Math.abs(event.clientY - pointer.startY))
    if (moved < VIDEO_MOVE_THRESHOLD_PX) return

    clearLongPress()
    restoreRate(pointer)
    pointer.mode = 'moved'
    clearFeedback()
  }

  const pointerUp = (event: FeedGesturePoint) => {
    const pointer = activePointer
    if (!pointer || pointer.id !== event.pointerId) return
    clearLongPress()
    activePointer = null

    if (pointer.mode === 'rate') {
      restoreRate(pointer)
      showFeedback({ kind: 'rate', title: `恢复 ${pointer.startPlaybackRate}×` })
      return
    }
    if (pointer.mode !== 'pending') return

    if (pointer.secondTap) {
      handleDoubleTap(event)
      return
    }
    singleTapTimer = setTimeout(() => {
      singleTapTimer = null
      handleSingleTap()
    }, VIDEO_TAP_DELAY_MS)
  }

  const pointerCancel = () => {
    clearLongPress()
    const pointer = activePointer
    activePointer = null
    if (pointer) restoreRate(pointer)
    clearFeedback()
  }

  return {
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    destroy() {
      if (destroyed) return
      destroyed = true
      pointerCancel()
      clearSingleTap()
      clearFeedbackTimer()
    }
  }
}
