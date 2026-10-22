'use client'

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLongPress } from '@/hooks/use-long-press'
import { cn } from '@/lib/utils'
import { MediaDetailsPlaceholder } from '@/lib/reading/artwork-reader-provider'
import type { ArtworkReadingHandle } from '@/lib/reading/reading-provider'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import LazyMedia from './lazy-media'
import { useArtworkSummary } from './artwork-summary-context'
import type { StackDecoration } from './artwork-stack-projection'

export function ArtworkStackCard({
  media,
  index,
  height,
  decoration,
  reading,
  trackingActive,
  onPreview,
  onMenu
}: {
  media: ArtworkImageResponseDto
  index: number
  height: number
  decoration: StackDecoration
  reading?: ArtworkReadingHandle
  trackingActive: boolean
  onPreview: (index: number, initialPreviewSrc?: string) => void
  onMenu: (event: React.MouseEvent | React.TouchEvent, index: number, failed?: boolean) => void
}) {
  const summary = useArtworkSummary()
  const [failed, setFailed] = useState(false)
  const [settled, setSettled] = useState(false)
  const [offset, setOffset] = useState(0)
  const pointer = useRef<{ id: number; x: number; y: number; horizontal: boolean; vertical: boolean } | null>(null)
  const suppressActivation = useRef(false)
  const cancelGesture = useCallback(() => {
    pointer.current = null
    suppressActivation.current = true
    setOffset(0)
  }, [])
  const { group, mediaIds, activeIndex } = decoration
  useEffect(() => {
    setSettled(false)
    setFailed(false)
    const timer = window.setTimeout(
      () => setSettled(true),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 180
    )
    return () => window.clearTimeout(timer)
  }, [media.id])
  const flip = useCallback(
    (delta: number) => {
      if (summary?.navigating) return
      const id = mediaIds[activeIndex + delta]
      if (id === undefined) return
      useArtworkAutoBrowseStore.getState().pause('manual')
      setSettled(false)
      summary?.selectMedia(id)
    },
    [activeIndex, mediaIds, summary?.selectMedia, summary?.navigating]
  )
  const gestures = useLongPress({
    onLongPress: (event) => {
      if (suppressActivation.current) return
      cancelGesture()
      onMenu(event, index, failed)
    },
    onClick: (event) => {
      if (suppressActivation.current) return
      const image = event.currentTarget.querySelector('img')
      onPreview(index, image?.currentSrc || image?.src || undefined)
    }
  })
  return (
    <section
      className="overflow-x-clip px-2 pb-3 pt-2"
      aria-label={`第 ${group.startIndex + 1} 至 ${group.endIndex + 1} 张`}
      data-stack-group={group.id}
      data-stack-transitioning={!settled || offset !== 0 ? 'true' : 'false'}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault()
          event.stopPropagation()
          flip(event.key === 'ArrowLeft' ? -1 : 1)
        }
      }}
    >
      <div className="relative isolate">
        {mediaIds.length > 2 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-6 inset-y-2 translate-x-1 translate-y-2 rotate-[4deg] rounded-2xl bg-card p-0.5 shadow-[0_2px_5px_rgb(0_0_0_/_0.12),0_12px_20px_-12px_rgb(0_0_0_/_0.2)]"
          >
            <div className="h-full rounded-xl bg-foreground/[0.06]" />
          </div>
        )}
        {mediaIds.length > 1 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-4 inset-y-1 -translate-x-1 translate-y-1 -rotate-[3deg] rounded-2xl bg-card p-0.5 shadow-[0_2px_5px_rgb(0_0_0_/_0.1),0_8px_16px_-8px_rgb(0_0_0_/_0.18)]"
          >
            <div className="h-full rounded-xl bg-foreground/[0.035]" />
          </div>
        )}
        <div
          className={cn(
            'relative z-10 translate-x-[var(--stack-drag)] rounded-[14px] bg-card p-0.5 shadow-[0_3px_6px_rgb(0_0_0_/_0.1),0_18px_32px_-16px_rgb(0_0_0_/_0.28)] motion-safe:rotate-[var(--stack-tilt)]',
            offset === 0 && 'motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out'
          )}
          style={{ '--stack-drag': `${offset}px`, '--stack-tilt': `${offset / 32}deg` } as CSSProperties}
        >
          <div
            {...gestures}
            role="button"
            tabIndex={0}
            aria-label={`放大第 ${media.sortOrder + 1} 张图片`}
            className="relative cursor-zoom-in select-none overflow-hidden rounded-xl bg-foreground/[0.025] outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            style={{ height, touchAction: 'pan-y pinch-zoom', WebkitTouchCallout: 'none' }}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                onPreview(index)
              }
            }}
            onPointerDown={(event) => {
              if (event.pointerType === 'touch' && !event.isPrimary) {
                cancelGesture()
                return
              }
              if (!event.isPrimary || event.button !== 0) return
              suppressActivation.current = false
              useArtworkAutoBrowseStore.getState().pause('manual')
              pointer.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                horizontal: false,
                vertical: false
              }
              // Capture before moving: touch starts with implicit capture on the nested media element.
              event.currentTarget.setPointerCapture(event.pointerId)
            }}
            onTouchStart={(event) => {
              gestures.onTouchStart(event)
              if (event.touches.length !== 1) cancelGesture()
            }}
            onTouchCancel={(event) => {
              gestures.onTouchCancel(event)
              cancelGesture()
            }}
            onPointerMove={(event) => {
              const start = pointer.current
              if (!start || start.id !== event.pointerId || start.vertical) return
              const x = event.clientX - start.x
              const y = event.clientY - start.y
              if (Math.abs(x) > 10 || Math.abs(y) > 10) suppressActivation.current = true
              if (!start.horizontal && Math.abs(y) > 10 && Math.abs(y) >= Math.abs(x)) {
                start.vertical = true
                return
              }
              if (!start.horizontal && Math.abs(x) > 10 && Math.abs(x) > Math.abs(y) * 1.25) {
                start.horizontal = true
              }
              if (start.horizontal) setOffset(Math.max(-56, Math.min(56, x * 0.35)))
            }}
            onPointerUp={(event) => {
              const start = pointer.current
              if (!start || start.id !== event.pointerId) return
              pointer.current = null
              setOffset(0)
              const x = event.clientX - start.x
              const y = event.clientY - start.y
              if (Math.abs(x) > 10 || Math.abs(y) > 10) suppressActivation.current = true
              if (!start.vertical && Math.abs(x) >= 40 && (start.horizontal || Math.abs(x) > Math.abs(y) * 1.25)) {
                flip(x < 0 ? 1 : -1)
              }
            }}
            onPointerCancel={(event) => {
              if (pointer.current?.id === event.pointerId) cancelGesture()
            }}
            onLostPointerCapture={(event) => {
              // Capture loss bubbles; a descendant relinquishing capture must not cancel our swipe.
              if (event.target === event.currentTarget && pointer.current?.id === event.pointerId) cancelGesture()
            }}
          >
            <div className="h-full w-full [&_img]:pointer-events-none">
              {media.detailsPending ? (
                <MediaDetailsPlaceholder media={media} index={index} fill />
              ) : (
                <LazyMedia
                  key={`${media.id}:${media.path}:${media.updatedAt}`}
                  media={media}
                  index={index}
                  fill
                  autoMode="slideshow"
                  reading={reading}
                  trackingActive={trackingActive && settled && offset === 0}
                  onPreviewStatusChange={(status) => setFailed(status === 'error')}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <div className="relative mx-auto mt-3 flex h-6 w-fit items-center justify-center px-11">
        <Button
          variant="ghost"
          size="icon"
          className="absolute left-0 top-1/2 size-11 -translate-y-1/2 rounded-full"
          aria-label="组内上一张"
          disabled={activeIndex === 0 || summary?.navigating}
          onClick={() => flip(-1)}
        >
          <ChevronLeft />
        </Button>
        <div className="flex items-center gap-1.5 whitespace-nowrap px-1 text-[11px] leading-none tabular-nums text-muted-foreground">
          <span>
            {String(group.startIndex + 1).padStart(3, '0')}–{String(group.endIndex + 1).padStart(3, '0')}
          </span>
          <span aria-hidden="true">·</span>
          <span aria-live="polite" aria-atomic="true">
            {activeIndex + 1}/{mediaIds.length}
          </span>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="absolute right-0 top-1/2 size-11 -translate-y-1/2 rounded-full"
          aria-label="组内下一张"
          disabled={activeIndex === mediaIds.length - 1 || summary?.navigating}
          onClick={() => flip(1)}
        >
          <ChevronRight />
        </Button>
      </div>
    </section>
  )
}
