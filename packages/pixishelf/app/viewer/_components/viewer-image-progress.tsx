'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'

interface ViewerImageProgressProps {
  index: number
  count: number
  disabled: boolean
  onSeekingChange: (seeking: boolean) => void
  onCommit: (index: number) => void
}

export default function ViewerImageProgress({
  index,
  count,
  disabled,
  onSeekingChange,
  onCommit
}: ViewerImageProgressProps) {
  const [positionPreview, setPositionPreview] = useState<number | null>(null)
  const positionPreviewRef = useRef<number | null>(null)
  const positionKeyboardRef = useRef(false)
  const cancelPositionPreview = useCallback(() => {
    positionPreviewRef.current = null
    positionKeyboardRef.current = false
    setPositionPreview(null)
    onSeekingChange(false)
  }, [onSeekingChange])

  useEffect(() => {
    cancelPositionPreview()
    const cancelHidden = () => {
      if (document.visibilityState === 'hidden') cancelPositionPreview()
    }
    window.addEventListener('blur', cancelPositionPreview)
    document.addEventListener('visibilitychange', cancelHidden)
    return () => {
      cancelPositionPreview()
      window.removeEventListener('blur', cancelPositionPreview)
      document.removeEventListener('visibilitychange', cancelHidden)
    }
  }, [cancelPositionPreview, index, disabled])

  const previewPosition = (index: number) => {
    if (disabled) return
    positionPreviewRef.current = index
    setPositionPreview(index)
    onSeekingChange(true)
  }

  const commitPosition = () => {
    const target = positionPreviewRef.current
    cancelPositionPreview()
    if (target !== null && !disabled && target !== index) onCommit(target)
  }

  return (
    <div
      data-viewer-control
      className="flex min-h-11 items-center gap-3 text-white"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerMove={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation()
        if (event.key === 'Escape') cancelPositionPreview()
      }}
    >
      <Slider
        aria-label="图片位置"
        min={1}
        max={count}
        step={1}
        value={[(positionPreview ?? index) + 1]}
        disabled={disabled}
        onPointerDown={() => previewPosition(index)}
        onValueChange={(values) => {
          if (positionPreviewRef.current !== null || positionKeyboardRef.current) {
            previewPosition((values[0] ?? index + 1) - 1)
          }
        }}
        onValueCommit={() => {
          if (!positionKeyboardRef.current) commitPosition()
        }}
        onKeyDownCapture={() => {
          positionKeyboardRef.current = true
        }}
        onKeyUp={commitPosition}
        onPointerUp={() => {
          if (positionPreviewRef.current === index) cancelPositionPreview()
        }}
        onPointerCancel={cancelPositionPreview}
        onBlur={cancelPositionPreview}
        className="h-11 [&_[data-slot=slider-range]]:bg-white/90 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-track]]:h-px [&_[data-slot=slider-track]]:bg-white/30"
      />
      <span aria-label="图片位置计数" className="ml-auto shrink-0 text-xs tabular-nums text-white/85">
        {(positionPreview ?? index) + 1} / {count}
      </span>
    </div>
  )
}

export function ViewerImagePagination({ hidden, index, count }: { hidden: boolean; index: number; count: number }) {
  return (
    <div
      aria-hidden={hidden}
      inert={hidden}
      className={cn(
        'pointer-events-none absolute inset-0 z-30 transition-opacity duration-150 motion-reduce:transition-none',
        hidden && 'opacity-0'
      )}
    >
      <div className="swiper-pagination-custom absolute !bottom-0.5 left-4 right-4 z-30">
        <div className="flex w-full gap-1">
          {Array.from({ length: count }, (_, position) => (
            <div
              key={position}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-300 ease-out',
                position <= index ? 'bg-white' : 'bg-white/20'
              )}
            />
          ))}
        </div>
      </div>
      <div className="absolute right-4 top-4 z-30 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
        {index + 1} / {count}
      </div>
    </div>
  )
}
