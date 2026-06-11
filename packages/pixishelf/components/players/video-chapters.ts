'use client'

import { z } from 'zod'
import { formatTime } from '@/lib/utils'

const VideoChapterSchema = z.looseObject({
  index: z.number().int().positive(),
  title: z.string().trim().min(1),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  file: z.string().optional()
})

const VideoChapterManifestSchema = z.looseObject({
  source: z.enum(['chapters-file', 'mp4-embedded', 'database']).optional(),
  version: z.union([z.literal(1), z.literal(2)]),
  duration: z.number().nonnegative(),
  chapters: z.array(VideoChapterSchema)
})

export type VideoChapterManifest = z.infer<typeof VideoChapterManifestSchema>
export type VideoChapter = z.infer<typeof VideoChapterSchema>

export interface NormalizedChapter {
  id: string
  index: number
  title: string
  start: number
  end: number
  duration: number
}

export interface TimelineMarker {
  id: string
  type: 'chapter' | 'favorite' | 'bookmark' | 'note'
  title: string
  time: number
}

export interface TimelineMarkerCluster {
  id: string
  marker: TimelineMarker
  markers: TimelineMarker[]
  count: number
  time: number
}

interface ClusterTimelineMarkersOptions {
  duration: number
  width: number
  minSpacingPx: number
}

/**
 * 统一标准化章节数据，避免播放器内部依赖后端原始结构。
 */
export function normalizeVideoChapterManifest(input: unknown): {
  duration: number
  chapters: NormalizedChapter[]
} {
  const manifest = VideoChapterManifestSchema.parse(input)

  return {
    duration: manifest.duration,
    chapters: manifest.chapters
      .map((chapter) => ({
        id: `chapter-${chapter.index}-${chapter.start}`,
        index: chapter.index,
        title: chapter.title,
        start: chapter.start,
        end: chapter.end,
        duration: chapter.duration
      }))
      .sort((left, right) => left.start - right.start)
  }
}

export function getCurrentChapter(chapters: NormalizedChapter[], currentTime: number): NormalizedChapter | undefined {
  if (chapters.length === 0) {
    return undefined
  }

  const lastChapter = chapters.at(-1)
  if (lastChapter && currentTime === lastChapter.end) {
    return lastChapter
  }

  return chapters.find((chapter) => currentTime >= chapter.start && currentTime < chapter.end)
}

export function createChapterTimelineMarkers(chapters: NormalizedChapter[]): TimelineMarker[] {
  return chapters.map((chapter) => ({
    id: chapter.id,
    type: 'chapter',
    title: chapter.title,
    time: chapter.start
  }))
}

export function getMarkerPercent(time: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) {
    return 0
  }

  return Math.min(Math.max((time / duration) * 100, 0), 100)
}

export function clusterTimelineMarkers(
  markers: TimelineMarker[],
  { duration, width, minSpacingPx }: ClusterTimelineMarkersOptions
): TimelineMarkerCluster[] {
  if (markers.length === 0 || !Number.isFinite(duration) || duration <= 0) {
    return []
  }

  const sortedMarkers = [...markers].sort((left, right) => left.time - right.time)

  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(minSpacingPx) || minSpacingPx <= 0) {
    return sortedMarkers.map((marker) => ({
      id: marker.id,
      marker,
      markers: [marker],
      count: 1,
      time: marker.time
    }))
  }

  const clusters: TimelineMarkerCluster[] = []

  for (const marker of sortedMarkers) {
    const previousCluster = clusters.at(-1)

    if (!previousCluster) {
      clusters.push({
        id: marker.id,
        marker,
        markers: [marker],
        count: 1,
        time: marker.time
      })
      continue
    }

    const clusterLeft = (previousCluster.time / duration) * width
    const markerLeft = (marker.time / duration) * width

    if (markerLeft - clusterLeft < minSpacingPx) {
      previousCluster.markers.push(marker)
      previousCluster.count = previousCluster.markers.length
      previousCluster.id = `${previousCluster.marker.id}-cluster-${previousCluster.count}`
    } else {
      clusters.push({
        id: marker.id,
        marker,
        markers: [marker],
        count: 1,
        time: marker.time
      })
    }
  }

  return clusters
}

export function formatChapterTime(seconds: number): string {
  return formatTime(Math.max(Math.floor(seconds), 0))
}
