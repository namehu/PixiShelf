'use client'

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { animate, useMotionValue, useReducedMotion } from 'framer-motion'
import { usePreviewControlsPreferences, type PreviewControlsDock } from '@/store/use-preview-controls-preferences'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'

type Bounds = { left: number; right: number; top: number; bottom: number; centerX: number; centerY: number }
const anchor = (dock: PreviewControlsDock, bounds: Bounds) => ({
  x: dock === 'left' ? bounds.left : dock === 'right' ? bounds.right : bounds.centerX,
  y: dock === 'bottom' ? bounds.bottom : bounds.centerY
})
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function usePreviewControlsDock(open = true) {
  const [stage, stageRef] = useState<HTMLDivElement | null>(null)
  const [controls, controlsRef] = useState<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState<'mobile' | 'desktop'>('mobile')
  const dock = usePreviewControlsPreferences((state) => state[viewport])
  const setDock = usePreviewControlsPreferences((state) => state.setDock)
  const [dragging, setDragging] = useState(false)
  const pointer = useRef<{
    id: number
    clientX: number
    clientY: number
    x: number
    y: number
    moved: boolean
    handle: HTMLElement
  } | null>(null)
  const bounds = useRef<Bounds>({ left: 0, right: 0, top: 0, bottom: 0, centerX: 0, centerY: 0 })
  const x = useMotionValue(0)
  const y = useMotionValue(0)
  const placed = useRef(false)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    void Promise.resolve(usePreviewControlsPreferences.persist.rehydrate()).catch(() => undefined)
    const query = window.matchMedia('(min-width: 640px)')
    const update = () => setViewport(query.matches ? 'desktop' : 'mobile')
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const moveToDock = useCallback(
    (nextDock: PreviewControlsDock, immediate = false) => {
      const target = anchor(nextDock, bounds.current)
      x.stop()
      y.stop()
      if (immediate || reducedMotion || !placed.current) {
        x.set(target.x)
        y.set(target.y)
      } else {
        void animate(x, target.x, { duration: 0.24, ease: [0.16, 1, 0.3, 1] })
        void animate(y, target.y, { duration: 0.24, ease: [0.16, 1, 0.3, 1] })
      }
      placed.current = true
    },
    [reducedMotion, x, y]
  )
  const release = useCallback(() => {
    const active = pointer.current
    pointer.current = null
    setDragging(false)
    if (active?.handle.hasPointerCapture(active.id)) active.handle.releasePointerCapture(active.id)
    return active
  }, [])
  const cancel = useCallback(() => {
    release()
    moveToDock(dock)
  }, [dock, release, moveToDock])

  useLayoutEffect(() => {
    if (!stage || !controls) return
    const measure = () => {
      release()
      const insets = getComputedStyle(stage)
      const left = parseFloat(insets.paddingLeft) || 12
      const top = parseFloat(insets.paddingTop) || 64
      const right = Math.max(left, stage.clientWidth - (parseFloat(insets.paddingRight) || 12) - controls.offsetWidth)
      const bottom = Math.max(
        top,
        stage.clientHeight - (parseFloat(insets.paddingBottom) || 12) - controls.offsetHeight
      )
      bounds.current = {
        left,
        top,
        right,
        bottom,
        centerX: clamp((stage.clientWidth - controls.offsetWidth) / 2, left, right),
        centerY: clamp((stage.clientHeight - controls.offsetHeight) / 2, top, bottom)
      }
      moveToDock(dock)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    observer.observe(controls)
    window.addEventListener('resize', measure)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', measure)
      release()
      x.stop()
      y.stop()
    }
  }, [open, dock, viewport, stage, controls, moveToDock, release, x, y])

  return {
    dock,
    dragging,
    stageRef,
    controlsRef,
    x,
    y,
    orientation: dock === 'bottom' ? ('horizontal' as const) : ('vertical' as const),
    settingsSide: dock === 'left' ? ('right' as const) : dock === 'right' ? ('left' as const) : ('top' as const),
    onEscapeKeyDown: (event: KeyboardEvent) => {
      if (!pointer.current) return
      // Radix handles Escape during document capture, before the handle's keydown.
      event.preventDefault()
      event.stopPropagation()
      cancel()
    },
    handleProps: {
      onPointerDown: (event: React.PointerEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        if (event.isPrimary === false || event.button !== 0) {
          if (pointer.current) cancel()
          return
        }
        event.preventDefault()
        event.currentTarget.focus({ preventScroll: true })
        x.stop()
        y.stop()
        pointer.current = {
          id: event.pointerId,
          clientX: event.clientX,
          clientY: event.clientY,
          x: x.get(),
          y: y.get(),
          moved: false,
          handle: event.currentTarget
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      },
      onPointerMove: (event: React.PointerEvent) => {
        const active = pointer.current
        if (!active || active.id !== event.pointerId) return
        event.stopPropagation()
        const dx = event.clientX - active.clientX
        const dy = event.clientY - active.clientY
        if (!active.moved && Math.hypot(dx, dy) < 7) return
        if (!active.moved) {
          active.moved = true
          setDragging(true)
          useArtworkAutoBrowseStore.getState().pause('manual')
        }
        x.set(clamp(active.x + dx, bounds.current.left, bounds.current.right))
        y.set(clamp(active.y + dy, bounds.current.top, bounds.current.bottom))
      },
      onPointerUp: (event: React.PointerEvent) => {
        event.stopPropagation()
        const active = pointer.current
        if (!active || active.id !== event.pointerId) return
        release()
        if (!active.moved) return
        const docks: PreviewControlsDock[] = ['bottom', 'left', 'right']
        const nearest = docks.reduce((best, candidate) => {
          const a = anchor(best, bounds.current),
            b = anchor(candidate, bounds.current)
          return Math.hypot(x.get() - b.x, y.get() - b.y) < Math.hypot(x.get() - a.x, y.get() - a.y) ? candidate : best
        })
        setDock(viewport, nearest)
        moveToDock(nearest)
      },
      onPointerCancel: cancel,
      onLostPointerCapture: () => {
        if (pointer.current) cancel()
      },
      onKeyDown: (event: React.KeyboardEvent) => {
        if (event.key === 'Escape' && pointer.current) {
          event.preventDefault()
          event.stopPropagation()
          cancel()
          return
        }
        const next =
          event.key === 'ArrowLeft'
            ? 'left'
            : event.key === 'ArrowRight'
              ? 'right'
              : ['ArrowDown', 'Home'].includes(event.key)
                ? 'bottom'
                : null
        if (!next) return
        event.preventDefault()
        event.stopPropagation()
        release()
        useArtworkAutoBrowseStore.getState().pause('manual')
        setDock(viewport, next)
        moveToDock(next)
      },
      onClick: (event: React.MouseEvent) => {
        event.preventDefault()
        event.stopPropagation()
      },
      onTouchStart: (event: React.TouchEvent) => event.stopPropagation(),
      onTouchMove: (event: React.TouchEvent) => event.stopPropagation()
    }
  }
}
