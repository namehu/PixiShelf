'use client'

import { useRef, useState, type SyntheticEvent } from 'react'
import { ListVideoIcon, Loader2Icon, PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from 'lucide-react'
import ChapterSidebar from '@/components/players/chapter-sidebar'
import { useCurrentChapter } from '@/components/players/use-current-chapter'
import { useVideoChapters } from '@/components/players/use-video-chapters'
import type { NormalizedChapter } from '@/components/players/video-chapters'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import type { ViewerMediaItem } from '@/types/images'

export interface ViewerAudioPreference {
  muted: boolean
  volume: number
}

export interface ViewerVideoState {
  currentTime: number
  duration: number
  isPlaying: boolean
  isWaiting: boolean
}

interface ViewerVideoControlsProps {
  media: ViewerMediaItem
  state: ViewerVideoState
  audioPreference: ViewerAudioPreference
  onTogglePlayback: () => void
  onSeek: (seconds: number) => void
  onSeekPreviewStart: () => void
  onSeekCommit: (seconds: number) => void
  onSeekPreviewCancel: () => void
  onToggleMuted: () => void
  onVolumeChange: (volume: number) => void
  chapterPanelOpen: boolean
  onChapterPanelOpenChange: (open: boolean) => void
}

function stopControlEvent(event: SyntheticEvent) {
  event.stopPropagation()
}

function validDuration(value?: number | null) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
}

export function formatViewerTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '--:--'
  }

  const totalSeconds = Math.floor(seconds)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const remainingSeconds = totalSeconds % 60

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`
    : `${minutes}:${String(remainingSeconds).padStart(2, '0')}`
}

export default function ViewerVideoControls({
  media,
  state,
  audioPreference,
  onTogglePlayback,
  onSeek,
  onSeekPreviewStart,
  onSeekCommit,
  onSeekPreviewCancel,
  onToggleMuted,
  onVolumeChange,
  chapterPanelOpen,
  onChapterPanelOpenChange
}: ViewerVideoControlsProps) {
  const [previewTime, setPreviewTime] = useState<number | null>(null)
  const previewingRef = useRef(false)
  const { chapters, duration: chaptersDuration, loading, error, reload } = useVideoChapters(media.chaptersUrl)
  const duration = validDuration(state.duration) || validDuration(media.duration) || validDuration(chaptersDuration)
  const playbackTime =
    duration > 0 ? Math.min(Math.max(state.currentTime, 0), duration) : Math.max(state.currentTime, 0)
  const currentTime = previewTime ?? playbackTime
  const currentChapter = useCurrentChapter(chapters, currentTime)
  const hasAudio = media.hasAudio !== false
  const hasChapters = Boolean(media.chaptersUrl)

  const handleChapterClick = (chapter: NormalizedChapter) => {
    onSeek(chapter.start)
  }

  const beginSeekPreview = () => {
    if (previewingRef.current) return
    previewingRef.current = true
    onSeekPreviewStart()
  }

  const handleSeekValueChange = (values: number[]) => {
    beginSeekPreview()
    setPreviewTime(values[0] ?? 0)
  }

  const handleSeekCommit = (values: number[]) => {
    const nextTime = values[0] ?? 0
    previewingRef.current = false
    setPreviewTime(null)
    onSeekCommit(nextTime)
  }

  const cancelSeekPreview = () => {
    if (!previewingRef.current) return
    previewingRef.current = false
    setPreviewTime(null)
    onSeekPreviewCancel()
  }

  return (
    <>
      <div
        data-viewer-control
        className="mb-3 text-white"
        onClick={stopControlEvent}
        onDoubleClick={stopControlEvent}
        onPointerDown={stopControlEvent}
        onPointerMove={stopControlEvent}
        onKeyDown={stopControlEvent}
      >
        <div className="relative flex h-6 items-center">
          {duration > 0 &&
            chapters.slice(1).map((chapter) => {
              const left = Math.min(Math.max((chapter.start / duration) * 100, 0), 100)
              return (
                <span
                  key={chapter.id}
                  aria-hidden="true"
                  className="pointer-events-none absolute z-10 h-2.5 w-px -translate-x-1/2 bg-white/70"
                  style={{ left: `${left}%` }}
                />
              )
            })}
          <Slider
            aria-label="视频进度"
            min={0}
            max={duration || 1}
            step={0.1}
            value={[duration > 0 ? currentTime : 0]}
            disabled={duration <= 0}
            onValueChange={handleSeekValueChange}
            onValueCommit={handleSeekCommit}
            onPointerCancel={cancelSeekPreview}
            className="z-20 h-6 cursor-pointer [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:opacity-0 [&_[data-slot=slider-thumb]]:shadow-none [&_[data-slot=slider-track]]:h-0.5 [&_[data-slot=slider-track]]:bg-white/35 hover:[&_[data-slot=slider-thumb]]:opacity-100 focus-within:[&_[data-slot=slider-thumb]]:opacity-100"
          />
        </div>

        <div className="flex min-w-0 items-center gap-1.5">
          <button
            type="button"
            className="flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
            onClick={onTogglePlayback}
            aria-label={state.isWaiting ? '视频正在缓冲' : state.isPlaying ? '暂停视频' : '播放视频'}
          >
            {state.isWaiting ? (
              <Loader2Icon className="size-5 animate-spin" />
            ) : state.isPlaying ? (
              <PauseIcon className="size-5 fill-current" />
            ) : (
              <PlayIcon className="size-5 fill-current" />
            )}
          </button>

          <span className="shrink-0 text-sm font-medium tabular-nums" aria-label="视频时间">
            {formatViewerTime(currentTime)} / {duration > 0 ? formatViewerTime(duration) : '--:--'}
          </span>

          <div className="group/volume ml-1 flex min-w-0 items-center">
            <button
              type="button"
              disabled={!hasAudio}
              className="flex size-10 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onToggleMuted}
              aria-label={!hasAudio ? '视频没有音轨' : audioPreference.muted ? '开启声音' : '静音'}
            >
              {!hasAudio || audioPreference.muted || audioPreference.volume === 0 ? (
                <VolumeXIcon className="size-5" />
              ) : (
                <Volume2Icon className="size-5" />
              )}
            </button>
            {hasAudio && (
              <div className="hidden w-0 overflow-hidden opacity-0 transition-[width,opacity] duration-150 md:block md:group-hover/volume:w-16 md:group-hover/volume:opacity-100 md:group-focus-within/volume:w-16 md:group-focus-within/volume:opacity-100">
                <Slider
                  aria-label="视频音量"
                  min={0}
                  max={1}
                  step={0.05}
                  value={[audioPreference.volume]}
                  onValueChange={(values) => onVolumeChange(values[0] ?? 0)}
                  className="w-14 [&_[data-slot=slider-range]]:bg-white [&_[data-slot=slider-thumb]]:size-3 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-track]]:bg-white/30"
                />
              </div>
            )}
          </div>

          {hasChapters && (
            <button
              type="button"
              className={cn(
                'ml-auto flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-2 text-sm transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80',
                chapterPanelOpen && 'bg-white/15'
              )}
              onClick={() => onChapterPanelOpenChange(true)}
              aria-label={currentChapter ? `章节：${currentChapter.title}` : '打开视频章节'}
              aria-expanded={chapterPanelOpen}
            >
              {loading ? (
                <Loader2Icon className="size-4 shrink-0 animate-spin" />
              ) : (
                <ListVideoIcon className="size-4 shrink-0" />
              )}
              <span className="max-w-24 truncate max-[360px]:hidden">{currentChapter?.title || '章节'}</span>
            </button>
          )}
        </div>
      </div>

      {hasChapters && (
        <Sheet open={chapterPanelOpen} onOpenChange={onChapterPanelOpenChange}>
          <SheetContent
            side="bottom"
            data-viewer-chapter-sheet
            closeLabel="关闭章节列表"
            overlayClassName="z-[200] bg-black/65"
            className="z-[200] h-[calc(clamp(210px,28dvh,236px)+env(safe-area-inset-bottom))] overflow-hidden rounded-t-2xl border-white/10 bg-neutral-950 px-0 pb-[env(safe-area-inset-bottom)] text-white shadow-2xl md:inset-x-auto md:bottom-[5vh] md:left-1/2 md:w-[420px] md:-translate-x-1/2 [&>button]:right-4 [&>button]:top-3 [&>button]:text-white/75"
          >
            <SheetHeader className="min-h-12 shrink-0 justify-center border-b border-white/10 px-4 py-2 text-left">
              <SheetTitle className="pr-10 text-base text-white">
                章节
                {!loading && chapters.length > 0 && (
                  <span className="ml-2 text-xs font-normal text-white/55">{chapters.length} 段</span>
                )}
              </SheetTitle>
              <SheetDescription className="sr-only">选择章节跳转到对应的视频时间</SheetDescription>
            </SheetHeader>

            <div className="relative min-h-0 flex-1 overflow-hidden">
              {loading ? (
                <div className="flex h-full items-center justify-center gap-2 text-sm text-white/60">
                  <Loader2Icon className="size-5 animate-spin" />
                  正在加载章节…
                </div>
              ) : error ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
                  <p className="text-sm text-white/65">{error}</p>
                  <button
                    type="button"
                    onClick={reload}
                    className="rounded-full bg-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/15"
                  >
                    重试
                  </button>
                </div>
              ) : chapters.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-white/55">暂无章节</div>
              ) : (
                <ChapterSidebar
                  chapters={chapters}
                  currentChapterId={currentChapter?.id}
                  onChapterClick={handleChapterClick}
                  tone="dark"
                  layout="horizontal"
                  className="h-full rounded-none border-none bg-transparent [&_.pixishelf-chapter-card-horizontal]:basis-[calc((100%_-_0.75rem)/2)]"
                />
              )}
              {!loading && !error && chapters.length > 2 && (
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-y-0 right-0 w-5 bg-gradient-to-l from-neutral-950 to-transparent"
                />
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  )
}
