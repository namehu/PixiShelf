'use client'

import React, { memo, useCallback, useEffect, useRef } from 'react'
import { Heart, Sparkle } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { ArtworkRatingLevel } from '@/schemas/artwork-rating.dto'

export interface LikeButtonProps {
  liked: boolean
  onToggleLike: () => void
  onOpenRating?: () => void
  disabled?: boolean
  saving?: boolean
  label?: string
  ratingLevel?: ArtworkRatingLevel
  buttonRef?: React.Ref<HTMLButtonElement>
  className?: string
}

/** A long press consumes its release click; the shared rating queue owns pending writes. */
export const LikeButton: React.FC<LikeButtonProps> = ({
  className,
  liked,
  onToggleLike,
  onOpenRating,
  disabled,
  saving,
  label,
  ratingLevel,
  buttonRef
}) => {
  const press = useRef<{ id: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | null>(null)
  const suppressClick = useRef(false)
  const cancelPress = useCallback(() => {
    if (!press.current) return
    clearTimeout(press.current.timer)
    press.current = null
    suppressClick.current = true
  }, [])
  useEffect(() => {
    window.addEventListener('blur', cancelPress)
    const hidden = () => {
      if (document.hidden) cancelPress()
    }
    document.addEventListener('visibilitychange', hidden)
    return () => {
      cancelPress()
      window.removeEventListener('blur', cancelPress)
      document.removeEventListener('visibilitychange', hidden)
    }
  }, [cancelPress, onOpenRating, disabled])
  const accessibleLabel = label ?? (liked ? '取消喜欢并清除评分' : '喜欢作品')

  return (
    <Button
      ref={buttonRef}
      type="button"
      variant="ghost"
      size="icon"
      aria-label={accessibleLabel}
      title={accessibleLabel}
      aria-description={onOpenRating ? '长按选择作品评分，也可从更多操作打开' : undefined}
      aria-pressed={liked}
      aria-busy={saving || undefined}
      data-rating-level={liked ? ratingLevel ?? 2 : undefined}
      className={cn(
        'relative flex size-12 touch-none select-none items-center justify-center rounded-full bg-black/20 text-white shadow-floating backdrop-blur-sm transition-[color,background-color,transform] hover:scale-105 hover:bg-black/30 hover:text-white active:scale-95 motion-reduce:transform-none',
        'focus-visible:ring-2 focus-visible:ring-white/70',
        'viewer-rating-heart',
        className
      )}
      onPointerDown={(event) => {
        event.stopPropagation()
        cancelPress()
        suppressClick.current = false
        if (disabled || !onOpenRating || event.button !== 0 || event.isPrimary === false) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        press.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
          timer: setTimeout(() => {
            suppressClick.current = true
            press.current = null
            onOpenRating()
          }, 500)
        }
      }}
      onPointerMove={(event) => {
        event.stopPropagation()
        const current = press.current
        if (current && Math.hypot(event.clientX - current.x, event.clientY - current.y) > 10) cancelPress()
      }}
      onPointerUp={(event) => {
        event.stopPropagation()
        if (press.current?.id === event.pointerId) {
          clearTimeout(press.current.timer)
          press.current = null
        }
      }}
      onPointerCancel={(event) => {
        event.stopPropagation()
        cancelPress()
      }}
      onLostPointerCapture={cancelPress}
      onBlur={cancelPress}
      onContextMenu={(event) => {
        event.preventDefault()
        event.stopPropagation()
      }}
      onClick={(event) => {
        event.preventDefault()
        event.stopPropagation()
        if (suppressClick.current && event.detail !== 0) {
          suppressClick.current = false
          return
        }
        suppressClick.current = false
        onToggleLike()
      }}
      disabled={disabled}
    >
      <span className="viewer-rating-glyph" aria-hidden="true">
        <Heart className={cn('viewer-rating-main size-6', liked && 'fill-current')} />
        {liked && ratingLevel === 3 && <Heart className="viewer-rating-echo fill-current" />}
        {liked && ratingLevel === 4 && <Sparkle className="viewer-rating-spark fill-current" />}
      </span>
      {saving && <Spinner className="absolute right-0 top-0 size-3" aria-label="正在保存评分" />}
    </Button>
  )
}

export default memo(LikeButton)
