'use client'

import { useEffect, useState, type RefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { ARTWORK_RATING_LABELS, type ArtworkRatingLevel } from '@/schemas/artwork-rating.dto'
import type { useArtworkRating } from '@/hooks/use-artwork-rating'

export function ViewerRatingDialog({
  open,
  onOpenChange,
  rating,
  disabled,
  returnFocusRef
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  rating: ReturnType<typeof useArtworkRating>
  disabled: boolean
  returnFocusRef: RefObject<HTMLButtonElement | null>
}) {
  const [submitted, setSubmitted] = useState<{ level: ArtworkRatingLevel } | null>(null)
  useEffect(() => {
    if (!open) setSubmitted(null)
    else if (submitted && !rating.isSaving && !rating.error) {
      if (rating.confirmedLevel === submitted.level) {
        setSubmitted(null)
        onOpenChange(false)
      }
    }
  }, [open, submitted, rating.isSaving, rating.error, rating.confirmedLevel, onOpenChange])
  const choose = (level: ArtworkRatingLevel) => {
    setSubmitted({ level })
    rating.setLevel(level)
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="top-auto bottom-[calc(1.5rem+env(safe-area-inset-bottom))] w-80 translate-y-0 gap-3 p-4 sm:max-w-sm"
        data-viewer-control
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          if (returnFocusRef.current?.isConnected) returnFocusRef.current.focus({ preventScroll: true })
        }}
      >
        <DialogHeader>
          <DialogTitle className="text-sm">作品评分</DialogTitle>
          <DialogDescription aria-live="polite">
            当前：{rating.level === null ? '未评分' : ARTWORK_RATING_LABELS[rating.level]}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label="选择作品评分">
          {([2, 3, 4] as const).map((level) => (
            <Button
              key={level}
              type="button"
              className="min-h-11 px-2"
              variant={rating.level === level ? 'default' : 'secondary'}
              aria-pressed={rating.level === level}
              disabled={disabled || rating.isLoading}
              onClick={() => choose(level)}
            >
              {ARTWORK_RATING_LABELS[level]}
            </Button>
          ))}
        </div>
        <Button
          type="button"
          variant="ghost"
          className="min-h-11"
          disabled={disabled || rating.isLoading}
          onClick={() => choose(null)}
        >
          清除评分
        </Button>
        {rating.isSaving && (
          <p role="status" className="text-center text-xs text-muted-foreground">
            正在保存评分…
          </p>
        )}
        {rating.error && (
          <div role="alert" className="flex items-center justify-between gap-2 text-sm">
            <span>评分未保存，请重试。</span>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={disabled}
              onClick={() => {
                void rating.retry()
              }}
            >
              重试
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
