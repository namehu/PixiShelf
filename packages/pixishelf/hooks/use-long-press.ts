import { useRef, useCallback, useEffect } from 'react'

interface UseLongPressOptions {
  onLongPress: (event: React.MouseEvent | React.TouchEvent) => void
  onClick?: (event: React.MouseEvent | React.TouchEvent) => void
  threshold?: number
}

export function useLongPress({ onLongPress, onClick, threshold = 500 }: UseLongPressOptions) {
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const startPos = useRef<{ x: number; y: number } | null>(null)
  const ignoreMouseUntil = useRef(0)
  const suppressClick = useRef(false)

  const cancel = useCallback(() => {
    if (timeout.current !== null) clearTimeout(timeout.current)
    timeout.current = null
    startPos.current = null
  }, [])

  const start = useCallback(
    (event: React.MouseEvent | React.TouchEvent) => {
      if ('touches' in event) {
        ignoreMouseUntil.current = Date.now() + 1000
        if (event.touches.length !== 1) {
          suppressClick.current = true
          cancel()
          return
        }
      } else if (event.button !== 0 || Date.now() < ignoreMouseUntil.current) {
        return
      }

      cancel()
      suppressClick.current = false
      if ('touches' in event) {
        const touch = event.touches[0]!
        startPos.current = { x: touch.clientX, y: touch.clientY }
      }

      timeout.current = setTimeout(() => {
        timeout.current = null
        suppressClick.current = true
        // Default touch behavior must be handled by CSS/contextmenu, not an expired event.
        onLongPress(event)
      }, threshold)
    },
    [cancel, onLongPress, threshold]
  )

  const clear = useCallback(
    (event: React.MouseEvent | React.TouchEvent, shouldTriggerClick = true) => {
      if ('touches' in event) {
        ignoreMouseUntil.current = Date.now() + 1000
      } else if (Date.now() < ignoreMouseUntil.current) {
        return
      }
      const wasPending = timeout.current !== null
      cancel()
      if (!shouldTriggerClick) suppressClick.current = true
      if (wasPending && shouldTriggerClick && onClick) {
        suppressClick.current = true
        onClick(event)
      }
    },
    [cancel, onClick]
  )

  const onTouchMove = useCallback((event: React.TouchEvent) => {
    if (!startPos.current) return
    const touch = event.touches[0]
    if (
      event.touches.length !== 1 || !touch ||
      Math.abs(touch.clientX - startPos.current.x) > 10 ||
      Math.abs(touch.clientY - startPos.current.y) > 10
    ) {
      suppressClick.current = true
      cancel()
    }
  }, [cancel])

  useEffect(() => cancel, [cancel])

  return {
    onMouseDown: start,
    onTouchStart: start,
    onMouseUp: clear,
    onMouseLeave: (e: React.MouseEvent) => clear(e, false),
    onTouchEnd: clear,
    onTouchCancel: (e: React.TouchEvent) => clear(e, false),
    onTouchMove,
    onClickCapture: (event: React.MouseEvent) => {
      // A touch release can emit a compatibility click after the menu has opened.
      if (suppressClick.current) {
        event.preventDefault()
        event.stopPropagation()
      }
    },
    onContextMenu: (event: React.MouseEvent) => event.preventDefault()
  }
}
