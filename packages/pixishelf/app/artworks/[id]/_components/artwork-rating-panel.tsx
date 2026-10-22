'use client'

import * as DialogPrimitive from '@radix-ui/react-dialog'
import * as SliderPrimitive from '@radix-ui/react-slider'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { LoaderCircleIcon, SparklesIcon } from 'lucide-react'
import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogOverlay, DialogPortal, DialogTitle } from '@/components/ui/dialog'
import type { useArtworkRating } from '@/hooks/use-artwork-rating'
import { ARTWORK_RATING_LABELS, type ArtworkRatingLevel } from '@/schemas/artwork-rating.dto'

const labels = ['未评分', ...Object.values(ARTWORK_RATING_LABELS)]
const savedAnimationMs = 280
const particles = Array.from({ length: 16 }, (_, index) => ({
  left: 7 + ((index * 29) % 86),
  top: 18 + ((index * 37) % 64),
  delay: (index % 5) * 0.09
}))

export interface ArtworkRatingPanelProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onReturnFocus: () => void
  rating: ReturnType<typeof useArtworkRating>
}

/** Dismissing the panel never cancels a committed rating. */
export function ArtworkRatingPanel({ open, onOpenChange, onReturnFocus, rating }: ArtworkRatingPanelProps) {
  const [draft, setDraft] = useState(rating.level ?? 0)
  const [celebration, setCelebration] = useState(0)
  const [celebrating, setCelebrating] = useState(false)
  const [saved, setSaved] = useState(false)
  const wasSaving = useRef(false)
  const dragging = useRef(false)
  const cancelled = useRef(false)
  const draftRef = useRef(draft)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const reducedMotion = useReducedMotion()

  useEffect(() => {
    if (!dragging.current) {
      setDraft(rating.level ?? 0)
      draftRef.current = rating.level ?? 0
    }
  }, [open, rating.level])

  useEffect(() => {
    if (!open) {
      dragging.current = false
      cancelled.current = true
      setCelebrating(false)
      setSaved(false)
    }
  }, [open])

  useEffect(() => {
    if (open && wasSaving.current && !rating.isSaving && !rating.error && !dragging.current) setSaved(true)
    if (rating.isSaving || rating.error || !open) setSaved(false)
    wasSaving.current = open && rating.isSaving
  }, [open, rating.isSaving, rating.error])

  useEffect(() => {
    if (!saved || !open || rating.isSaving || rating.error) return
    const timer = setTimeout(() => onOpenChange(false), (reducedMotion ? 0 : savedAnimationMs) + 200)
    return () => clearTimeout(timer)
  }, [saved, open, rating.isSaving, rating.error, reducedMotion, onOpenChange])

  useEffect(() => {
    if (!celebrating) return
    const timer = setTimeout(() => setCelebrating(false), 3200)
    return () => clearTimeout(timer)
  }, [celebration, celebrating])

  const cancelPreview = () => {
    cancelled.current = true
    dragging.current = false
    draftRef.current = rating.level ?? 0
    setDraft(rating.level ?? 0)
    setCelebrating(false)
  }
  useEffect(() => {
    if (!open) return
    const blur = () => {
      if (dragging.current) cancelPreview()
    }
    window.addEventListener('blur', blur)
    return () => window.removeEventListener('blur', blur)
  }, [open, rating.level])

  const preview = (value: number) => {
    setSaved(false)
    if (value >= 3 && draftRef.current !== value && !reducedMotion) {
      setCelebration((prior) => prior + 1)
      setCelebrating(true)
    }
    if (value < 3) setCelebrating(false)
    draftRef.current = value
    setDraft(value)
  }
  const commit = (value: number) => {
    if (cancelled.current) return
    dragging.current = false
    rating.setLevel(value === 0 ? null : (value as Exclude<ArtworkRatingLevel, null>))
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) cancelPreview()
        onOpenChange(next)
      }}
    >
      <DialogPortal>
        <DialogOverlay className="artwork-rating-overlay" />
        <DialogPrimitive.Content
          className="artwork-rating-panel"
          aria-describedby={undefined}
          data-level={draft}
          data-celebrating={(celebrating && !reducedMotion) || undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            thumbRef.current?.focus()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            onReturnFocus()
          }}
        >
          <DialogTitle className="sr-only">作品评分</DialogTitle>
          <div className="relative flex h-8 items-center justify-center" aria-hidden="true">
            <AnimatePresence initial={false}>
              <motion.div
                key={draft}
                className="artwork-rating-heading absolute flex items-center gap-2 whitespace-nowrap"
                initial={reducedMotion ? false : { opacity: 0, y: 7, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -7 }}
                transition={{ duration: reducedMotion ? 0 : 0.16 }}
              >
                {draft === 4 && <SparklesIcon className="size-5" />}
                <span className="text-2xl font-semibold tracking-tight">{labels[draft]}</span>
              </motion.div>
            </AnimatePresence>
          </div>

          <div className="artwork-rating-input mt-2">
            <SliderPrimitive.Root
              value={[draft]}
              min={0}
              max={4}
              step={1}
              disabled={rating.isLoading}
              className="artwork-rating-slider"
              onPointerDownCapture={() => {
                setSaved(false)
                dragging.current = true
                cancelled.current = false
              }}
              onPointerUpCapture={() => {
                dragging.current = false
              }}
              onPointerCancel={cancelPreview}
              onKeyDownCapture={(event) => {
                cancelled.current = false
                if (event.key === 'Escape') cancelPreview()
              }}
              onValueChange={([value]) => preview(value!)}
              onValueCommit={([value]) => commit(value!)}
            >
              <SliderPrimitive.Track className="artwork-rating-track">
                <span className="artwork-rating-fill" style={{ transform: `scaleX(${draft / 4})` }} />
                <span className="artwork-rating-ticks" aria-hidden="true">
                  {labels.map((label) => (
                    <i key={label} />
                  ))}
                </span>
                {draft === 4 && celebrating && !reducedMotion && (
                  <span key={celebration} className="artwork-rating-particles" aria-hidden="true">
                    {particles.map((particle, index) => (
                      <i
                        key={index}
                        style={
                          {
                            left: `${particle.left}%`,
                            top: `${particle.top}%`,
                            '--particle-delay': `${particle.delay}s`
                          } as CSSProperties
                        }
                      />
                    ))}
                  </span>
                )}
              </SliderPrimitive.Track>
              <SliderPrimitive.Thumb
                ref={thumbRef}
                className="artwork-rating-thumb"
                aria-label="作品评分"
                aria-valuetext={labels[draft]}
                aria-busy={rating.isLoading || rating.isSaving || undefined}
              >
                {rating.isLoading || rating.isSaving ? (
                  <LoaderCircleIcon
                    className="artwork-rating-saving size-4 animate-spin motion-reduce:animate-none"
                    aria-hidden="true"
                  />
                ) : saved ? (
                  <motion.svg
                    className="artwork-rating-saved size-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    initial={reducedMotion ? false : { opacity: 0, scale: 0.6 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: reducedMotion ? 0 : savedAnimationMs / 1000, ease: 'easeOut' }}
                  >
                    <motion.path
                      d="m5 12 4 4L19 6"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      initial={reducedMotion ? false : { pathLength: 0 }}
                      animate={{ pathLength: 1 }}
                      transition={{ duration: reducedMotion ? 0 : savedAnimationMs / 1000 }}
                    />
                  </motion.svg>
                ) : null}
              </SliderPrimitive.Thumb>
            </SliderPrimitive.Root>
            <div className="artwork-rating-labels" aria-hidden="true">
              {labels.map((label, index) => (
                <span key={label} data-active={index === draft || undefined}>
                  {label}
                </span>
              ))}
            </div>
          </div>

          <div className="sr-only" role="status" aria-live="polite">
            {rating.error
              ? '评分未保存'
              : rating.isLoading
                ? '正在读取评分'
                : rating.isSaving
                  ? '保存中'
                  : saved
                    ? '评分已保存'
                    : ''}
          </div>
          {rating.error && (
            <div className="mt-2 flex items-center justify-center gap-2 text-xs text-destructive">
              <span>评分未保存</span>
              <Button variant="ghost" size="sm" className="min-h-11" onClick={rating.retry}>
                重试
              </Button>
            </div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
