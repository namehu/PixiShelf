'use client'

import { useCallback, useEffect, useRef, type HTMLAttributes } from 'react'

const USER_SCROLL_COOLDOWN_MS = 1000
const SCROLL_KEYS = new Set([
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'PageUp',
  'PageDown',
  'Home',
  'End',
  ' '
])

export function useActiveItemVisibility(activeId?: string) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<Record<string, HTMLElement | null>>({})
  const activeIdRef = useRef(activeId)
  const pointerDownRef = useRef(false)
  const lastUserScrollAtRef = useRef(0)
  const programmaticScrollUntilRef = useRef(0)
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const ensureActiveVisible = useCallback(() => {
    const currentId = activeIdRef.current
    const viewport = viewportRef.current
    const item = currentId ? itemRefs.current[currentId] : null
    if (!viewport || !item) return

    const viewportRect = viewport.getBoundingClientRect()
    const itemRect = item.getBoundingClientRect()
    const outside =
      itemRect.left < viewportRect.left ||
      itemRect.right > viewportRect.right ||
      itemRect.top < viewportRect.top ||
      itemRect.bottom > viewportRect.bottom

    if (!outside) return
    programmaticScrollUntilRef.current = Date.now() + USER_SCROLL_COOLDOWN_MS
    item.scrollIntoView?.({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [])

  const scheduleAfterUserScroll = useCallback(() => {
    lastUserScrollAtRef.current = Date.now()
    if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current)
    reconcileTimerRef.current = setTimeout(() => {
      reconcileTimerRef.current = null
      ensureActiveVisible()
    }, USER_SCROLL_COOLDOWN_MS)
  }, [ensureActiveVisible])

  useEffect(() => {
    activeIdRef.current = activeId
    const remaining = USER_SCROLL_COOLDOWN_MS - (Date.now() - lastUserScrollAtRef.current)
    if (remaining > 0) {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current)
      reconcileTimerRef.current = setTimeout(() => {
        reconcileTimerRef.current = null
        ensureActiveVisible()
      }, remaining)
      return
    }
    ensureActiveVisible()
  }, [activeId, ensureActiveVisible])

  useEffect(
    () => () => {
      if (reconcileTimerRef.current) clearTimeout(reconcileTimerRef.current)
    },
    []
  )

  const interactionProps: HTMLAttributes<HTMLElement> = {
    onWheelCapture: scheduleAfterUserScroll,
    onTouchStartCapture: scheduleAfterUserScroll,
    onTouchMoveCapture: scheduleAfterUserScroll,
    onTouchEndCapture: scheduleAfterUserScroll,
    onPointerDownCapture: () => {
      pointerDownRef.current = true
      scheduleAfterUserScroll()
    },
    onPointerMoveCapture: () => {
      if (pointerDownRef.current) scheduleAfterUserScroll()
    },
    onPointerUpCapture: () => {
      pointerDownRef.current = false
      scheduleAfterUserScroll()
    },
    onPointerCancelCapture: () => {
      pointerDownRef.current = false
      scheduleAfterUserScroll()
    },
    onKeyDownCapture: (event) => {
      if (SCROLL_KEYS.has(event.key)) scheduleAfterUserScroll()
    },
    onScrollCapture: () => {
      if (Date.now() > programmaticScrollUntilRef.current) scheduleAfterUserScroll()
    }
  }

  const setItemRef = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      itemRefs.current[id] = element
    },
    []
  )

  return { viewportRef, setItemRef, interactionProps }
}
