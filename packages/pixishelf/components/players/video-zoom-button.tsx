'use client'

import { ZoomInIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'

export const VIDEO_ZOOM_LEVELS = [1, 1.5, 2, 2.5, 3] as const
export type VideoZoom = (typeof VIDEO_ZOOM_LEVELS)[number]

export function VideoZoomButton({
  zoom,
  onZoomChange,
  disabled = false
}: {
  zoom: VideoZoom
  onZoomChange: (zoom: VideoZoom) => void
  disabled?: boolean
}) {
  const next = VIDEO_ZOOM_LEVELS[(VIDEO_ZOOM_LEVELS.indexOf(zoom) + 1) % VIDEO_ZOOM_LEVELS.length]!
  const label = zoom === 1 ? '完整' : `${zoom}×`

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      disabled={disabled}
      aria-label={`画面缩放：${zoom === 1 ? '完整画面' : `${zoom}倍`}`}
      title={next === 1 ? '恢复完整画面' : `放大到 ${next} 倍（裁切边缘）`}
      className="h-11 min-w-11 gap-1 rounded-full px-2 text-xs tabular-nums text-white/85 hover:bg-white/10 hover:text-white focus-visible:ring-white/70 dark:hover:bg-white/10"
      onPointerDown={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.stopPropagation()
        onZoomChange(next)
      }}
    >
      <ZoomInIcon aria-hidden="true" data-icon="inline-start" />
      {label}
    </Button>
  )
}
