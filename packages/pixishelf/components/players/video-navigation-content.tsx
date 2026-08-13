'use client'

import { Loader2Icon, RotateCcwIcon } from 'lucide-react'
import ChapterSidebar from './chapter-sidebar'
import VideoKeyframeSidebar from './video-keyframe-sidebar'
import type { NormalizedChapter } from './video-chapters'
import type { NormalizedVideoKeyframe } from './video-keyframes'
import { cn } from '@/lib/utils'

export type VideoNavigationTab = 'chapters' | 'keyframes'

interface VideoNavigationHeaderProps {
  activeTab: VideoNavigationTab
  onTabChange: (tab: VideoNavigationTab) => void
  chaptersAvailable: boolean
  chapterCount: number
  keyframesAvailable: boolean
  keyframeCount: number
  compact?: boolean
}

export function VideoNavigationHeader({
  activeTab,
  onTabChange,
  chaptersAvailable,
  chapterCount,
  keyframesAvailable,
  keyframeCount,
  compact = false
}: VideoNavigationHeaderProps) {
  const bothAvailable = chaptersAvailable && keyframesAvailable
  if (!bothAvailable) {
    const keyframesOnly = keyframesAvailable
    return (
      <div className={cn('min-w-0 font-medium text-white', compact ? 'text-sm' : 'text-base')}>
        {keyframesOnly ? '画面' : '章节'}
        <span className="ml-2 text-xs font-normal text-white/55">
          {keyframesOnly ? `${keyframeCount} 张` : `${chapterCount} 段`}
        </span>
      </div>
    )
  }

  return (
    <div
      role="tablist"
      aria-label="视频导航"
      className="inline-flex min-w-0 items-center rounded-lg bg-white/[0.07] p-0.5 ring-1 ring-inset ring-white/10"
    >
      <NavigationTabButton
        active={activeTab === 'chapters'}
        label="章节"
        count={chapterCount}
        unit="段"
        onClick={() => onTabChange('chapters')}
      />
      <NavigationTabButton
        active={activeTab === 'keyframes'}
        label="画面"
        count={keyframeCount}
        unit="张"
        onClick={() => onTabChange('keyframes')}
      />
    </div>
  )
}

function NavigationTabButton({
  active,
  label,
  count,
  unit,
  onClick
}: {
  active: boolean
  label: string
  count: number
  unit: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400',
        active ? 'bg-white text-neutral-950 shadow-sm' : 'text-white/65 hover:bg-white/[0.07] hover:text-white'
      )}
    >
      {label}
      <span className={cn('ml-1 font-normal tabular-nums', active ? 'text-neutral-500' : 'text-white/45')}>
        {count} {unit}
      </span>
    </button>
  )
}

interface VideoNavigationBodyProps {
  activeTab: VideoNavigationTab
  chapters: NormalizedChapter[]
  chaptersLoading: boolean
  chaptersError: string | null
  onChaptersRetry: () => void
  currentChapterId?: string
  onChapterClick: (chapter: NormalizedChapter) => void
  keyframes: NormalizedVideoKeyframe[]
  keyframesLoading: boolean
  keyframesError: string | null
  onKeyframesRetry: () => void
  currentKeyframeId?: string
  onKeyframeClick: (keyframe: NormalizedVideoKeyframe) => void
  layout: 'grid' | 'horizontal'
  className?: string
  scrollAreaClassName?: string
  horizontalCardClassName?: string
}

export function VideoNavigationBody({
  activeTab,
  chapters,
  chaptersLoading,
  chaptersError,
  onChaptersRetry,
  currentChapterId,
  onChapterClick,
  keyframes,
  keyframesLoading,
  keyframesError,
  onKeyframesRetry,
  currentKeyframeId,
  onKeyframeClick,
  layout,
  className,
  scrollAreaClassName,
  horizontalCardClassName
}: VideoNavigationBodyProps) {
  if (activeTab === 'chapters') {
    if (chaptersLoading && chapters.length === 0) return <NavigationLoading label="正在加载章节…" />
    if (chaptersError && chapters.length === 0) {
      return <NavigationError message={chaptersError} onRetry={onChaptersRetry} />
    }
    if (chapters.length === 0) return <NavigationEmpty label="暂无章节" />

    return (
      <ChapterSidebar
        chapters={chapters}
        currentChapterId={currentChapterId}
        onChapterClick={onChapterClick}
        tone="dark"
        layout={layout}
        className={cn(className, horizontalCardClassName)}
        scrollAreaClassName={scrollAreaClassName}
      />
    )
  }

  if (keyframesLoading && keyframes.length === 0) return <NavigationLoading label="正在加载画面…" />
  if (keyframesError && keyframes.length === 0) {
    return <NavigationError message={keyframesError} onRetry={onKeyframesRetry} />
  }
  if (keyframes.length === 0) return <NavigationEmpty label="暂无画面" />

  return (
    <VideoKeyframeSidebar
      keyframes={keyframes}
      currentKeyframeId={currentKeyframeId}
      onKeyframeClick={onKeyframeClick}
      tone="dark"
      layout={layout}
      className={cn(className, horizontalCardClassName)}
      scrollAreaClassName={scrollAreaClassName}
    />
  )
}

function NavigationLoading({ label }: { label: string }) {
  return (
    <div className="flex h-full min-h-32 items-center justify-center gap-2 text-sm text-white/60">
      <Loader2Icon className="size-5 animate-spin" aria-hidden="true" />
      {label}
    </div>
  )
}

function NavigationError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="flex h-full min-h-32 flex-col items-center justify-center gap-3 px-6 text-center">
      <p className="text-sm text-white/65">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <RotateCcwIcon className="size-3.5" aria-hidden="true" />
        重试
      </button>
    </div>
  )
}

function NavigationEmpty({ label }: { label: string }) {
  return <div className="flex h-full min-h-32 items-center justify-center text-sm text-white/55">{label}</div>
}
