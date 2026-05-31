'use client'

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { formatChapterTime, getMarkerPercent, type TimelineMarker } from './video-chapters'

interface TimelineMarkersProps {
  markers: TimelineMarker[]
  duration: number
  onMarkerClick: (marker: TimelineMarker) => void
  className?: string
  markerClassName?: string
  lineClassName?: string
  tooltipSide?: 'top' | 'right' | 'bottom' | 'left'
}

export default function TimelineMarkers({
  markers,
  duration,
  onMarkerClick,
  className,
  markerClassName,
  lineClassName,
  tooltipSide = 'top'
}: TimelineMarkersProps) {
  if (markers.length === 0 || duration <= 0) {
    return null
  }

  return (
    <div className={cn('pointer-events-none absolute inset-0', className)}>
      {markers.map((marker) => {
        const left = getMarkerPercent(marker.time, duration)

        return (
          <Tooltip key={marker.id}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={`跳转到章节 ${marker.title}`}
                className={cn(
                  'pointer-events-auto absolute top-1/2 z-10 h-0 w-0 -translate-x-1/2 -translate-y-1/2',
                  markerClassName
                )}
                style={{ left: `${left}%` }}
                onClick={(event) => {
                  event.stopPropagation()
                  onMarkerClick(marker)
                }}
              >
                <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2" />
                <span
                  className={cn(
                    'absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]',
                    lineClassName
                  )}
                />
              </button>
            </TooltipTrigger>
            <TooltipContent side={tooltipSide} sideOffset={6} className="bg-black/90 px-2 py-1 text-white">
              <div className="font-medium">{marker.title}</div>
              <div className="text-[11px] text-white/70">{formatChapterTime(marker.time)}</div>
            </TooltipContent>
          </Tooltip>
        )
      })}
    </div>
  )
}
