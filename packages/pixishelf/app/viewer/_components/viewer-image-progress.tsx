'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { Slider } from '@/components/ui/slider'

interface ViewerImageProgressProps {
  hidden: boolean
  index: number
  count: number
  disabled: boolean
  onSeekingChange: (seeking: boolean) => void
  onCommit: (index: number) => void
}

export default function ViewerImageProgress({
  hidden,
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
  }, [cancelPositionPreview, index, disabled, hidden])

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

  const segments = (
    <div
      data-viewer-image-segments
      aria-hidden="true"
      className="pointer-events-none absolute inset-x-0 bottom-0 flex gap-1"
    >
      {Array.from({ length: count }, (_, position) => (
        <div
          key={position}
          data-active={position <= (positionPreview ?? index)}
          className={cn(
            'h-1 flex-1 rounded-full transition-colors duration-300 ease-out motion-reduce:transition-none',
            position <= (positionPreview ?? index) ? 'bg-white' : 'bg-white/20'
          )}
        />
      ))}
    </div>
  )

  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div
        data-viewer-control={hidden ? true : undefined}
        className={cn(
          'absolute bottom-[max(0.125rem,env(safe-area-inset-bottom))] left-4 right-4 h-11 rounded-sm has-[:focus-visible]:outline has-[:focus-visible]:outline-1 has-[:focus-visible]:outline-white/70',
          hidden && 'pointer-events-auto'
        )}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerMove={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          event.stopPropagation()
          if (event.key === 'Escape') cancelPositionPreview()
        }}
      >
        {hidden && (
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
            className="absolute inset-0 h-full [&_[data-slot=slider-track]]:opacity-0 [&_[data-slot=slider-thumb]]:opacity-0"
          />
        )}
        {segments}
      </div>
      {!hidden && (
        <div className="absolute right-4 top-4 rounded-full bg-black/50 px-3 py-1 text-sm text-white">
          {index + 1} / {count}
        </div>
      )}
    </div>
  )
}
