'use client'

import Image from 'next/image'
import { ImageOffIcon, Loader2Icon, VideoIcon } from 'lucide-react'
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
  layout?: 'grid' | 'horizontal'
}

export default function ChapterSidebar({
  chapters,
  currentChapterId,
  onChapterClick,
  className,
  scrollAreaClassName,
  tone = 'dark',
  layout = 'grid'
}: ChapterSidebarProps) {
  const itemRefs = useRef<Record<string, HTMLButtonElement | null>>({})

  useEffect(() => {
    if (!currentChapterId) {
      return
    }

    itemRefs.current[currentChapterId]?.scrollIntoView?.({
      block: 'nearest',
      inline: layout === 'horizontal' ? 'nearest' : undefined,
      behavior: 'smooth'
    })
  }, [currentChapterId, layout])

  if (chapters.length === 0) {
    return null
  }

  const isLight = tone === 'light'

  const renderChapter = (chapter: NormalizedChapter) => {
    const isActive = currentChapterId === chapter.id

    return (
      <button
        key={chapter.id}
        ref={(element) => {
          itemRefs.current[chapter.id] = element
        }}
        type="button"
        onClick={() => onChapterClick(chapter)}
        aria-current={isActive ? 'true' : undefined}
        className={cn(
          'group relative min-w-0 overflow-hidden rounded-lg border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
          layout === 'horizontal' && 'pixishelf-chapter-card-horizontal h-full shrink-0 snap-start',
          isActive
            ? isLight
              ? 'border-blue-500 bg-blue-50 text-neutral-900 ring-1 ring-blue-500'
              : 'border-blue-400 bg-white/12 text-white ring-1 ring-blue-400'
            : isLight
              ? 'border-neutral-200 bg-white text-neutral-700 hover:border-neutral-300 hover:bg-neutral-50'
              : 'border-white/10 bg-white/5 text-white/80 hover:border-white/25 hover:bg-white/10 hover:text-white'
        )}
      >
        <span
          data-chapter-preview
          className={cn('relative block aspect-video overflow-hidden', isLight ? 'bg-neutral-100' : 'bg-black/50')}
        >
          {chapter.previewUrl ? (
            <Image
              src={chapter.previewUrl}
              alt={`${chapter.title} 章节截图`}
              fill
              sizes={layout === 'horizontal' ? '50vw' : '(min-width: 1024px) 220px, 50vw'}
              className="object-cover transition-transform duration-200 group-hover:scale-[1.02]"
            />
          ) : (
            <span
              className={cn(
                'flex h-full w-full flex-col items-center justify-center gap-1 text-[11px]',
                isLight ? 'text-neutral-400' : 'text-white/45'
              )}
            >
              {chapter.previewStatus === 'GENERATING' ? (
                <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" />
              ) : chapter.previewStatus === 'FAILED' ? (
                <ImageOffIcon className="h-5 w-5" aria-hidden="true" />
              ) : (
                <VideoIcon className="h-5 w-5" aria-hidden="true" />
              )}
              <span>
                {chapter.previewStatus === 'GENERATING'
                  ? '生成中'
                  : chapter.previewStatus === 'FAILED'
                    ? '生成失败'
                    : '待生成'}
              </span>
            </span>
          )}
          <span
            data-chapter-time
            className="absolute bottom-1 left-1 rounded bg-black/70 px-1.5 py-0.5 text-[10px] tabular-nums text-white"
          >
            {formatChapterTime(chapter.start)}
          </span>
        </span>
        <span data-chapter-title className="block min-h-12 px-2 py-1.5 text-xs font-medium leading-4">
          <span className="line-clamp-2">{chapter.title}</span>
        </span>
      </button>
    )
  }

  return (
    <aside
      data-chapter-layout={layout}
      className={cn(
        'flex min-h-0 flex-col rounded-lg border',
        isLight ? 'border-neutral-200 bg-white text-neutral-900' : 'border-white/10 bg-black/30 text-white/90',
        className
      )}
    >
      {layout === 'horizontal' ? (
        <div
          className={cn(
            'flex min-h-0 flex-1 snap-x snap-mandatory items-stretch gap-3 overflow-x-auto px-3 pb-3 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
            scrollAreaClassName
          )}
        >
          {chapters.map(renderChapter)}
        </div>
      ) : (
        <ScrollArea className={cn('flex-1', scrollAreaClassName || 'max-h-72 sm:max-h-96')}>
          <div className="grid grid-cols-2 gap-2 p-2">{chapters.map(renderChapter)}</div>
        </ScrollArea>
      )}
    </aside>
  )
}
