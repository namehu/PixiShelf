'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import {
  clusterTimelineMarkers,
  getMarkerPercent,
  type TimelineMarker,
  type TimelineMarkerCluster
} from './video-chapters'

interface TimelineMarkersProps {
  markers: TimelineMarker[]
  duration: number
  onMarkerClick: (marker: TimelineMarker) => void
  width?: number
  minMarkerSpacingPx?: number
  className?: string
  markerClassName?: string
  lineClassName?: string
}

export default function TimelineMarkers({
  markers,
  duration,
  onMarkerClick,
  width,
  minMarkerSpacingPx = 18,
  className,
  markerClassName,
  lineClassName
}: TimelineMarkersProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [measuredWidth, setMeasuredWidth] = useState(0)
  const markerWidth = width ?? measuredWidth
  const markerClusters = useMemo(
    () => clusterTimelineMarkers(markers, { duration, width: markerWidth, minSpacingPx: minMarkerSpacingPx }),
    [duration, markerWidth, markers, minMarkerSpacingPx]
  )

  useEffect(() => {
    if (width !== undefined || !containerRef.current) {
      return
    }

    const element = containerRef.current
    const syncWidth = () => {
      setMeasuredWidth(element.getBoundingClientRect().width)
    }

    syncWidth()

    const ResizeObserverConstructor = window.ResizeObserver
    if (!ResizeObserverConstructor) {
      return
    }

    const resizeObserver = new ResizeObserverConstructor(syncWidth)
    resizeObserver.observe(element)

    return () => {
      resizeObserver.disconnect()
    }
  }, [width])

  if (markers.length === 0 || duration <= 0) {
    return null
  }

  return (
    <div ref={containerRef} className={cn('pointer-events-none absolute inset-0', className)}>
      {markerClusters.map((cluster) => {
        const left = getMarkerPercent(cluster.time, duration)
        const isCluster = cluster.count > 1

        return (
          <MarkerButton
            key={cluster.id}
            cluster={cluster}
            isCluster={isCluster}
            left={left}
            markerClassName={markerClassName}
            lineClassName={lineClassName}
            onMarkerClick={onMarkerClick}
          />
        )
      })}
    </div>
  )
}

interface MarkerButtonProps {
  cluster: TimelineMarkerCluster
  isCluster: boolean
  left: number
  markerClassName?: string
  lineClassName?: string
  onMarkerClick: (marker: TimelineMarker) => void
}

function MarkerButton({
  cluster,
  isCluster,
  left,
  markerClassName,
  lineClassName,
  onMarkerClick
}: MarkerButtonProps) {
  return (
    <button
      type="button"
      aria-label={
        isCluster ? `跳转到聚合章节 ${cluster.count} 个，起点 ${cluster.marker.title}` : `跳转到章节 ${cluster.marker.title}`
      }
      className={cn(
        'pointer-events-auto absolute top-1/2 z-10 h-0 w-0 -translate-x-1/2 -translate-y-1/2',
        markerClassName
      )}
      style={{ left: `${left}%` }}
      onClick={(event) => {
        event.stopPropagation()
        onMarkerClick(cluster.marker)
      }}
    >
      <span className="absolute left-1/2 top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2" />
      <span
        className={cn(
          'absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.18)]',
          lineClassName,
          isCluster && 'h-2 w-2 bg-blue-500 shadow-[0_0_0_1px_rgba(255,255,255,0.75)]'
        )}
      />
    </button>
  )
}
