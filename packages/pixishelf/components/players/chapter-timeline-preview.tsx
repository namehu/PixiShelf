'use client'

import Image from 'next/image'
import { ImageOffIcon, Loader2Icon, VideoIcon } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { formatChapterTime, getCurrentChapter, type NormalizedChapter } from './video-chapters'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

interface ChapterTimelinePreviewProps {
  target: HTMLDivElement
  chapters: NormalizedChapter[]
  duration: number
  forcedChapterId?: string | null
}

interface HoverState {
  chapterId: string
  x: number
}

const PREVIEW_WIDTH = 224

export default function ChapterTimelinePreview({
  target,
  chapters,
  duration,
  forcedChapterId
}: ChapterTimelinePreviewProps) {
  const [hovered, setHovered] = useState<HoverState | null>(null)
  const [targetWidth, setTargetWidth] = useState(0)

  useEffect(() => {
    const syncWidth = () => setTargetWidth(target.getBoundingClientRect().width)
    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType && event.pointerType !== 'mouse') return
      const rect = target.getBoundingClientRect()
      if (rect.width <= 0 || duration <= 0) return
      const x = Math.min(Math.max(event.clientX - rect.left, 0), rect.width)
      const chapter = getCurrentChapter(chapters, (x / rect.width) * duration)
      setHovered(chapter ? { chapterId: chapter.id, x } : null)
    }
    const handlePointerLeave = () => setHovered(null)

    syncWidth()
    target.addEventListener('pointermove', handlePointerMove)
    target.addEventListener('pointerleave', handlePointerLeave)
    const ResizeObserverConstructor = window.ResizeObserver
    const resizeObserver = ResizeObserverConstructor ? new ResizeObserverConstructor(syncWidth) : null
    resizeObserver?.observe(target)

    return () => {
      target.removeEventListener('pointermove', handlePointerMove)
      target.removeEventListener('pointerleave', handlePointerLeave)
      resizeObserver?.disconnect()
    }
  }, [chapters, duration, target])

  const active = useMemo(() => {
    const forcedChapter = forcedChapterId ? chapters.find((chapter) => chapter.id === forcedChapterId) : undefined
    if (forcedChapter) {
      return {
        chapter: forcedChapter,
        x: duration > 0 ? (forcedChapter.start / duration) * targetWidth : targetWidth / 2
      }
    }

    const hoveredChapter = hovered ? chapters.find((chapter) => chapter.id === hovered.chapterId) : undefined
    return hoveredChapter ? { chapter: hoveredChapter, x: hovered!.x } : null
  }, [chapters, duration, forcedChapterId, hovered, targetWidth])

  if (!active || targetWidth <= 0) return null

  const halfWidth = Math.min(PREVIEW_WIDTH / 2, targetWidth / 2)
  const left = Math.min(Math.max(active.x, halfWidth), Math.max(halfWidth, targetWidth - halfWidth))
  const chapter = active.chapter

  return (
    <div
      className="pointer-events-none absolute bottom-full z-40 mb-3 w-56 overflow-hidden rounded-lg border border-white/15 bg-black/95 text-white shadow-2xl"
      style={{ left, transform: 'translateX(-50%)' }}
      role="status"
      aria-live="polite"
    >
      <div className="relative aspect-video bg-neutral-900">
        {chapter.previewUrl ? (
          <Image src={chapter.previewUrl} alt="" fill sizes="224px" className="object-cover" />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-1 text-xs text-white/50">
            {chapter.previewStatus === 'GENERATING' ? (
              <Loader2Icon className="h-6 w-6 animate-spin" aria-hidden="true" />
            ) : chapter.previewStatus === 'FAILED' ? (
              <ImageOffIcon className="h-6 w-6" aria-hidden="true" />
            ) : (
              <VideoIcon className="h-6 w-6" aria-hidden="true" />
            )}
            <span>
              {chapter.previewStatus === 'GENERATING'
                ? '章节截图生成中'
                : chapter.previewStatus === 'FAILED'
                  ? '章节截图生成失败'
                  : '章节截图待生成'}
            </span>
          </div>
        )}
      </div>
      <div className="flex items-center gap-2 px-2.5 py-2 text-xs">
        <span className="shrink-0 tabular-nums text-white/60">{formatChapterTime(chapter.start)}</span>
        <PrivacySensitiveText className="min-w-0 flex-1 truncate font-medium">{chapter.title}</PrivacySensitiveText>
      </div>
    </div>
  )
}
