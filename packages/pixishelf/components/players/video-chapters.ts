'use client'

import { z } from 'zod'
import { formatTime } from '@/lib/utils'

const VideoChapterSchema = z.object({
  index: z.number().int().positive(),
  title: z.string().trim().min(1),
  start: z.number().nonnegative(),
  end: z.number().nonnegative(),
  duration: z.number().nonnegative(),
  file: z.string().optional()
})

const VideoChapterManifestSchema = z.object({
  source: z.enum(['chapters-file', 'mp4-embedded', 'database']).optional(),
  version: z.literal(1),
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

export function formatChapterTime(seconds: number): string {
  return formatTime(Math.max(Math.floor(seconds), 0))
}
