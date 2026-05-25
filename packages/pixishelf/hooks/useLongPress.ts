import { useRef, useCallback } from 'react'

interface UseLongPressOptions {
  onLongPress: (event: React.MouseEvent | React.TouchEvent) => void
  onClick?: (event: React.MouseEvent | React.TouchEvent) => void
  threshold?: number
}

export function useLongPress({ onLongPress, onClick, threshold = 500 }: UseLongPressOptions) {
  const timeout = useRef<NodeJS.Timeout | null>(null)
  const startPos = useRef<{ x: number; y: number } | null>(null)

  const start = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      // Only handle left click or touch
      if (event.nativeEvent instanceof MouseEvent && event.nativeEvent.button !== 0) return

      if (event.type === 'touchstart') {
        const touch = (event as React.TouchEvent).touches[0]!
        startPos.current = { x: touch.clientX, y: touch.clientY }
      } else {
        startPos.current = null
      }

      timeout.current = setTimeout(() => {
        onLongPress(event)
        timeout.current = null
      }, threshold)
    },
    [onLongPress, threshold]
  )

  const clear = useCallback(
    (event: React.MouseEvent | React.TouchEvent, shouldTriggerClick = true) => {
      if (timeout.current) {
        clearTimeout(timeout.current)
        timeout.current = null
        if (shouldTriggerClick && onClick) {
          onClick(event)
        }
      }
      startPos.current = null
    },
    [onClick]
  )

  const onTouchMove = useCallback((event: React.TouchEvent) => {
    if (startPos.current) {
      const touch = event.touches[0]!
      const dx = Math.abs(touch.clientX - startPos.current.x)
      const dy = Math.abs(touch.clientY - startPos.current.y)
      // If moved more than 10px, cancel long press
      if (dx > 10 || dy > 10) {
        if (timeout.current) {
          clearTimeout(timeout.current)
          timeout.current = null
        }
        startPos.current = null
      }
    }
  }, [])

  return {
    onMouseDown: start,
    onTouchStart: start,
    onMouseUp: clear,
    onMouseLeave: (e: React.MouseEvent) => clear(e, false),
    onTouchEnd: clear,
    onTouchMove: onTouchMove,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault()
    }
  }
}
