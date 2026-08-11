export const VIDEO_TAP_DELAY_MS = 300
export const VIDEO_LONG_PRESS_DELAY_MS = 1000
export const VIDEO_ACTION_LONG_PRESS_DELAY_MS = 500
export const VIDEO_MOVE_THRESHOLD_PX = 12
export const VIDEO_FEEDBACK_DURATION_MS = 750

export type VideoInteractionFeedbackKind = 'seek' | 'playback' | 'rate' | 'scrub' | 'like' | 'buffering'

export interface VideoInteractionFeedback {
  kind: VideoInteractionFeedbackKind
  title: string
  detail?: string
  persistent?: boolean
}

export type DoubleTapZone = 'backward' | 'middle' | 'forward'

export function getDoubleTapZone(clientX: number, rect: Pick<DOMRect, 'left' | 'width'>): DoubleTapZone {
  const ratio = rect.width > 0 ? (clientX - rect.left) / rect.width : 0.5
  if (ratio <= 0.2) return 'backward'
  if (ratio >= 0.8) return 'forward'
  return 'middle'
}

export function getDoubleTapAction(clientX: number, rect: Pick<DOMRect, 'left' | 'width'>) {
  const zone = getDoubleTapZone(clientX, rect)
  return zone === 'middle' ? ('toggle-playback' as const) : zone
}

export function getGestureSeekWindow(duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0
  return Math.min(Math.max(duration * 0.1, 30), 300)
}

export function getGestureSeekTarget({
  startTime,
  duration,
  deltaX,
  width
}: {
  startTime: number
  duration: number
  deltaX: number
  width: number
}): number {
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(width) || width <= 0) {
    return Math.max(startTime, 0)
  }

  const delta = (deltaX / width) * getGestureSeekWindow(duration)
  return Math.min(Math.max(startTime + delta, 0), duration)
}

export function formatInteractionTime(seconds: number) {
  const safeSeconds = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0))
  const hours = Math.floor(safeSeconds / 3600)
  const minutes = Math.floor((safeSeconds % 3600) / 60)
  const remainingSeconds = safeSeconds % 60
  const clock = `${String(minutes).padStart(hours > 0 ? 2 : 1, '0')}:${String(remainingSeconds).padStart(2, '0')}`
  return hours > 0 ? `${hours}:${clock}` : clock
}
