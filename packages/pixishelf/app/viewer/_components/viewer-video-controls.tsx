'use client'

import { useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { ImagesIcon, ListVideoIcon, Loader2Icon, PauseIcon, PlayIcon, Volume2Icon, VolumeXIcon } from 'lucide-react'
import { useCurrentChapter } from '@/components/players/use-current-chapter'
import { useVideoChapters } from '@/components/players/use-video-chapters'
import { useVideoKeyframes } from '@/components/players/use-video-keyframes'
import type { NormalizedChapter } from '@/components/players/video-chapters'
import { getNearestVideoKeyframe, type NormalizedVideoKeyframe } from '@/components/players/video-keyframes'
import {
  VideoNavigationBody,
  VideoNavigationHeader,
  type VideoNavigationTab
} from '@/components/players/video-navigation-content'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import type { ViewerMediaItem } from '@/types/images'
import { PrivacySensitiveText } from '@/components/privacy/privacy-sensitive-text'

const videoNavigationTabPreferences = new Map<number, VideoNavigationTab>()

function getPreferredVideoNavigationTab(media: ViewerMediaItem): VideoNavigationTab {
  return videoNavigationTabPreferences.get(media.id) ?? (media.chaptersUrl ? 'chapters' : 'keyframes')
}

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
  const [navigationTab, setNavigationTab] = useState<VideoNavigationTab>(() => getPreferredVideoNavigationTab(media))
  const previewingRef = useRef(false)
  const { chapters, duration: chaptersDuration, loading, loaded, error, reload } = useVideoChapters(media.chaptersUrl)
  const {
    keyframes,
    loading: keyframesLoading,
    loaded: keyframesLoaded,
    error: keyframesError,
    reload: reloadKeyframes
  } = useVideoKeyframes(media.keyframesUrl)
  const duration = validDuration(state.duration) || validDuration(media.duration) || validDuration(chaptersDuration)
  const playbackTime =
    duration > 0 ? Math.min(Math.max(state.currentTime, 0), duration) : Math.max(state.currentTime, 0)
  const currentTime = previewTime ?? playbackTime
  const currentChapter = useCurrentChapter(chapters, currentTime)
  const currentKeyframe = useMemo(() => getNearestVideoKeyframe(keyframes, currentTime), [keyframes, currentTime])
  const hasAudio = media.hasAudio !== false
  const chaptersAvailable = Boolean(media.chaptersUrl) && (!loaded || loading || Boolean(error) || chapters.length > 0)
  const keyframesAvailable =
    Boolean(media.keyframesUrl) &&
    (!keyframesLoaded || keyframesLoading || Boolean(keyframesError) || keyframes.length > 0)
  const navigationAvailable = chaptersAvailable || keyframesAvailable
  const chapterCount = chapters.length || media.chaptersCount || 0
  const keyframeCount = keyframes.length || media.keyframeCount || 0
  const bothAvailable = chaptersAvailable && keyframesAvailable

  useEffect(() => {
    setNavigationTab(getPreferredVideoNavigationTab(media))
  }, [media.chaptersUrl, media.id])

  useEffect(() => {
    if (navigationTab === 'chapters' && !chaptersAvailable && keyframesAvailable) setNavigationTab('keyframes')
    if (navigationTab === 'keyframes' && !keyframesAvailable && chaptersAvailable) setNavigationTab('chapters')
  }, [chaptersAvailable, keyframesAvailable, navigationTab])

  const handleChapterClick = (chapter: NormalizedChapter) => {
    onSeek(chapter.start)
  }

  const handleKeyframeClick = (keyframe: NormalizedVideoKeyframe) => {
    onSeek(keyframe.captureTime)
  }

  const handleNavigationTabChange = (tab: VideoNavigationTab) => {
    videoNavigationTabPreferences.set(media.id, tab)
    setNavigationTab(tab)
    if (tab === 'keyframes') reloadKeyframes()
  }

  const openNavigation = () => {
    if (navigationTab === 'keyframes') reloadKeyframes()
    onChapterPanelOpenChange(true)
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
        className="mb-2.5 text-white"
        onClick={stopControlEvent}
        onDoubleClick={stopControlEvent}
        onPointerDown={stopControlEvent}
        onPointerMove={stopControlEvent}
        onKeyDown={stopControlEvent}
      >
        <div className="relative flex h-5 items-center">
          {duration > 0 &&
            chapters.slice(1).map((chapter) => {
              const left = Math.min(Math.max((chapter.start / duration) * 100, 0), 100)
              return (
                <span
                  key={chapter.id}
                  aria-hidden="true"
                  className="pointer-events-none absolute z-10 h-2 w-px -translate-x-1/2 bg-white/65"
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
            className="z-20 h-5 cursor-pointer [&_[data-slot=slider-range]]:bg-white/90 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-thumb]]:opacity-0 [&_[data-slot=slider-thumb]]:shadow-none [&_[data-slot=slider-track]]:h-px [&_[data-slot=slider-track]]:bg-white/30 hover:[&_[data-slot=slider-thumb]]:opacity-100 focus-within:[&_[data-slot=slider-thumb]]:opacity-100"
          />
        </div>

        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/95 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
            onClick={onTogglePlayback}
            aria-label={state.isWaiting ? '视频正在缓冲' : state.isPlaying ? '暂停视频' : '播放视频'}
          >
            {state.isWaiting ? (
              <Loader2Icon className="size-4 animate-spin" />
            ) : state.isPlaying ? (
              <PauseIcon className="size-4 fill-current" />
            ) : (
              <PlayIcon className="size-4 fill-current" />
            )}
          </button>

          <span className="shrink-0 text-xs font-medium tabular-nums text-white/85" aria-label="视频时间">
            {formatViewerTime(currentTime)} / {duration > 0 ? formatViewerTime(duration) : '--:--'}
          </span>

          <div className="group/volume ml-0.5 flex min-w-0 items-center">
            <button
              type="button"
              disabled={!hasAudio}
              className="flex size-8 shrink-0 items-center justify-center rounded-full text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:cursor-not-allowed disabled:opacity-35"
              onClick={onToggleMuted}
              aria-label={!hasAudio ? '视频没有音轨' : audioPreference.muted ? '开启声音' : '静音'}
            >
              {!hasAudio || audioPreference.muted || audioPreference.volume === 0 ? (
                <VolumeXIcon className="size-4" />
              ) : (
                <Volume2Icon className="size-4" />
              )}
            </button>
            {hasAudio && (
              <div className="hidden w-0 overflow-hidden opacity-0 transition-[width,opacity] duration-150 md:block md:group-hover/volume:w-14 md:group-hover/volume:opacity-100 md:group-focus-within/volume:w-14 md:group-focus-within/volume:opacity-100">
                <Slider
                  aria-label="视频音量"
                  min={0}
                  max={1}
                  step={0.05}
                  value={[audioPreference.volume]}
                  onValueChange={(values) => onVolumeChange(values[0] ?? 0)}
                  className="w-12 [&_[data-slot=slider-range]]:bg-white/90 [&_[data-slot=slider-thumb]]:size-2.5 [&_[data-slot=slider-thumb]]:border-0 [&_[data-slot=slider-track]]:h-0.5 [&_[data-slot=slider-track]]:bg-white/25"
                />
              </div>
            )}
          </div>

          {navigationAvailable && (
            <button
              type="button"
              className={cn(
                'ml-auto flex min-w-0 items-center gap-1 rounded-full px-2 py-1.5 text-xs text-white/85 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70',
                chapterPanelOpen && 'bg-white/15'
              )}
              onClick={openNavigation}
              aria-label={
                bothAvailable
                  ? '打开视频导航'
                  : keyframesAvailable
                    ? '打开视频画面'
                    : currentChapter
                      ? `章节：${currentChapter.title}`
                      : '打开视频章节'
              }
              aria-expanded={chapterPanelOpen}
            >
              {loading || keyframesLoading ? (
                <Loader2Icon className="size-3.5 shrink-0 animate-spin" />
              ) : keyframesAvailable && !chaptersAvailable ? (
                <ImagesIcon className="size-3.5 shrink-0" />
              ) : (
                <ListVideoIcon className="size-3.5 shrink-0" />
              )}
              <span className="max-w-20 truncate max-[360px]:hidden">
                {bothAvailable ? (
                  '视频导航'
                ) : keyframesAvailable ? (
                  '画面'
                ) : currentChapter ? (
                  <PrivacySensitiveText>{currentChapter.title}</PrivacySensitiveText>
                ) : (
                  '章节'
                )}
              </span>
            </button>
          )}
        </div>
      </div>

      {navigationAvailable && (
        <Sheet open={chapterPanelOpen} onOpenChange={onChapterPanelOpenChange}>
          <SheetContent
            side="bottom"
            data-viewer-video-navigation-sheet
            closeLabel="关闭视频导航"
            overlayClassName="z-[200] bg-black/65"
            className="z-[200] h-[calc(clamp(210px,28dvh,236px)+env(safe-area-inset-bottom))] overflow-hidden rounded-t-2xl border-white/10 bg-neutral-950 px-0 pb-[env(safe-area-inset-bottom)] text-white shadow-2xl md:inset-x-auto md:bottom-[5vh] md:left-1/2 md:w-[420px] md:-translate-x-1/2 [&>button]:right-4 [&>button]:top-3 [&>button]:text-white/75"
          >
            <SheetHeader className="min-h-12 shrink-0 justify-center border-b border-white/10 px-4 py-2 text-left">
              <SheetTitle className="pr-10 text-base text-white">
                <VideoNavigationHeader
                  activeTab={navigationTab}
                  onTabChange={handleNavigationTabChange}
                  chaptersAvailable={chaptersAvailable}
                  chapterCount={chapterCount}
                  keyframesAvailable={keyframesAvailable}
                  keyframeCount={keyframeCount}
                />
              </SheetTitle>
              <SheetDescription className="sr-only">选择章节或画面跳转到对应的视频时间</SheetDescription>
            </SheetHeader>

            <div className="relative min-h-0 flex-1 overflow-hidden">
              <VideoNavigationBody
                activeTab={navigationTab}
                chapters={chapters}
                chaptersLoading={loading}
                chaptersError={error}
                onChaptersRetry={reload}
                currentChapterId={currentChapter?.id}
                onChapterClick={handleChapterClick}
                keyframes={keyframes}
                keyframesLoading={keyframesLoading}
                keyframesError={keyframesError}
                onKeyframesRetry={reloadKeyframes}
                currentKeyframeId={currentKeyframe?.id}
                onKeyframeClick={handleKeyframeClick}
                layout="horizontal"
                className="h-full rounded-none border-none bg-transparent [&_.pixishelf-chapter-card-horizontal]:basis-[calc((100%_-_0.75rem)/2)] [&_.pixishelf-keyframe-card-horizontal]:basis-[calc((100%_-_0.75rem)/2)]"
              />
              {((navigationTab === 'chapters' && !loading && !error && chapters.length > 2) ||
                (navigationTab === 'keyframes' && !keyframesLoading && !keyframesError && keyframes.length > 2)) && (
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
