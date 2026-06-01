'use client'

import { useEffect, useRef } from 'react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { formatChapterTime, type NormalizedChapter } from './video-chapters'

interface ChapterSidebarProps {
  chapters: NormalizedChapter[]
  currentChapterId?: string
  onChapterClick: (chapter: NormalizedChapter) => void
  className?: string
  scrollAreaClassName?: string
  tone?: 'dark' | 'light'
}

export default function ChapterSidebar({
  chapters,
  currentChapterId,
  onChapterClick,
  className,
  scrollAreaClassName,
  tone = 'dark'
}: ChapterSidebarProps) {
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (!currentChapterId) {
      return
    }

    itemRefs.current[currentChapterId]?.scrollIntoView({
      block: 'nearest',
      behavior: 'smooth'
    })
  }, [currentChapterId])

  if (chapters.length === 0) {
    return null
  }

  const isLight = tone === 'light'

  return (
    <aside
      className={cn(
        'flex min-h-0 flex-col rounded-lg border',
        isLight ? 'border-neutral-200 bg-white text-neutral-900' : 'border-white/10 bg-black/30 text-white/90',
        className
      )}
    >
      <ScrollArea className={cn('flex-1', scrollAreaClassName || 'max-h-72 sm:max-h-96')}>
        <div className="space-y-1 p-2">
          {chapters.map((chapter) => {
            const isActive = currentChapterId === chapter.id

            return (
              <button
                key={chapter.id}
                ref={(element) => {
                  itemRefs.current[chapter.id] = element
                }}
                type="button"
                onClick={() => onChapterClick(chapter)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-md border-l-2 px-3 py-1 text-left transition-colors',
                  isActive
                    ? isLight
                      ? 'border-blue-500 bg-blue-50 text-neutral-900'
                      : 'border-blue-400 bg-white/12 text-white'
                    : isLight
                      ? 'border-transparent text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900'
                      : 'border-transparent text-white/75 hover:bg-white/8 hover:text-white'
                )}
              >
                <span
                  className={cn(
                    'w-8 shrink-0 text-xs font-medium tabular-nums',
                    isLight ? 'text-neutral-400' : 'text-white/55'
                  )}
                >
                  {String(chapter.index).padStart(2, '0')}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{chapter.title}</span>
                <span className={cn('shrink-0 text-xs tabular-nums', isLight ? 'text-neutral-500' : 'text-white/60')}>
                  {formatChapterTime(chapter.start)}
                </span>
              </button>
            )
          })}
        </div>
      </ScrollArea>
    </aside>
  )
}
