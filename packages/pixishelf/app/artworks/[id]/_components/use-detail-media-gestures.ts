'use client'

import { useCallback, useEffect, useRef } from 'react'
import { useLongPress } from '@/hooks/use-long-press'

export type DetailMediaMenuEvent = React.MouseEvent | React.TouchEvent | React.KeyboardEvent
import type { LikePoint } from '@/components/media-mark/floating-like-hearts'

export function isDetailMediaControl(target: EventTarget | null, surface: EventTarget | null) {
  return (
    target instanceof Element &&
    target !== surface &&
    Boolean(target.closest('button, a, input, select, textarea, [role="button"], [data-long-press-ignore]'))
  )
}

export function useDetailMediaGestures({
  mediaId,
  onLike,
  onMenu
}: {
  mediaId: number
  onLike: (point: LikePoint) => void
  onMenu: (event: DetailMediaMenuEvent) => void
}) {
  const firstTap = useRef<(LikePoint & { time: number }) | null>(null)
  const start = useRef<LikePoint | null>(null)
  const cancelLongPress = useRef<(() => void) | null>(null)
  const longPress = useLongPress({
    cancelRef: cancelLongPress,
    onLongPress: (event) => {
      firstTap.current = null
      start.current = null
      onMenu(event)
    },
    onClick: (event) => {
      const position = 'changedTouches' in event ? event.changedTouches[0] : event
      const origin = start.current
      start.current = null
      if (!origin || !position || Math.hypot(position.clientX - origin.x, position.clientY - origin.y) > 10) {
        firstTap.current = null
        return
      }
      const point = { x: position.clientX, y: position.clientY }
      const previous = firstTap.current
      const time = Date.now()
      if (previous && time - previous.time <= 300 && Math.hypot(point.x - previous.x, point.y - previous.y) <= 40) {
        firstTap.current = null
        const rect = event.currentTarget.getBoundingClientRect()
        onLike({ x: point.x - rect.left, y: point.y - rect.top })
      } else firstTap.current = { ...point, time }
    }
  })
  const cancel = useCallback(() => {
    firstTap.current = null
    start.current = null
    cancelLongPress.current?.()
  }, [])
  useEffect(() => {
    cancel()
    return cancel
  }, [mediaId, cancel])
  const ignored = (event: React.SyntheticEvent) => isDetailMediaControl(event.target, event.currentTarget)

  return {
    cancel,
    surfaceProps: {
      onPointerDownCapture: (event: React.PointerEvent) => {
        // Player controls stop bubbling; an intervening control still ends a tap pair.
        if (ignored(event)) cancel()
      },
      onMouseDown: (event: React.MouseEvent) => {
        if (ignored(event)) {
          cancel()
          return
        }
        if (event.button === 0) start.current = { x: event.clientX, y: event.clientY }
        longPress.onMouseDown(event)
      },
      onMouseUp: (event: React.MouseEvent) => {
        if (!ignored(event)) longPress.onMouseUp(event)
      },
      onMouseMove: (event: React.MouseEvent) => {
        if (start.current && Math.hypot(event.clientX - start.current.x, event.clientY - start.current.y) > 10) cancel()
        longPress.onMouseMove(event)
      },
      onMouseLeave: (event: React.MouseEvent) => {
        cancel()
        longPress.onMouseLeave(event)
      },
      onTouchStart: (event: React.TouchEvent) => {
        if (ignored(event) || event.touches.length !== 1) {
          cancel()
          return
        }
        const touch = event.touches[0]!
        start.current = { x: touch.clientX, y: touch.clientY }
        longPress.onTouchStart(event)
      },
      onTouchMove: (event: React.TouchEvent) => {
        const touch = event.touches[0]
        if (
          event.touches.length !== 1 ||
          !touch ||
          (start.current && Math.hypot(touch.clientX - start.current.x, touch.clientY - start.current.y) > 10)
        ) {
          cancel()
        }
        longPress.onTouchMove(event)
      },
      onTouchEnd: (event: React.TouchEvent) => {
        if (!ignored(event)) longPress.onTouchEnd(event)
      },
      onTouchCancel: (event: React.TouchEvent) => {
        cancel()
        longPress.onTouchCancel(event)
      },
      onPointerCancel: cancel,
      onClickCapture: (event: React.MouseEvent) => {
        if (!ignored(event)) longPress.onClickCapture(event)
      },
      onContextMenu: (event: React.MouseEvent) => {
        if (ignored(event)) return
        event.preventDefault()
        cancel()
        onMenu(event)
      },
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        event.stopPropagation()
        cancel()
        onMenu(event)
      }
    }
  }
}
