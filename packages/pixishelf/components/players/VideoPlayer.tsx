'use client'

import { InfoIcon, Loader2Icon } from 'lucide-react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type ArtplayerType from 'artplayer'
import ChapterDrawer from '@/components/players/ChapterDrawer'
import ChapterSidebar from '@/components/players/ChapterSidebar'
import TimelineMarkers from '@/components/players/TimelineMarkers'
import { useCurrentChapter } from '@/components/players/use-current-chapter'
import { useVideoChapters } from '@/components/players/use-video-chapters'
import {
  createChapterTimelineMarkers,
  formatChapterTime,
  type NormalizedChapter
} from '@/components/players/video-chapters'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import { combinationApiResource } from '@/utils/combinationStatic'

export interface VideoPlayerProps {
  src: string
  chaptersUrl?: string | null
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  preload?: 'none' | 'metadata' | 'auto'
  className?: string
  onPlay?: () => void
  onPause?: () => void
  onError?: (error: string) => void
}

export function VideoPlayer({
  src,
  chaptersUrl,
  autoPlay = true,
  loop = true,
  muted = true,
  preload = 'metadata',
  className = '',
  onPlay,
  onPause,
  onError
}: VideoPlayerProps) {
  const mobileChapterControlName = 'chapter-entry'
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState('16 / 9')
  const [chapterDrawerOpen, setChapterDrawerOpen] = useState(false)
  const [artInstance, setArtInstance] = useState<ArtplayerType | null>(null)
  const [progressPortalTarget, setProgressPortalTarget] = useState<HTMLDivElement | null>(null)
  const hasStartedPlayingRef = useRef(false)
  const playerContainerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<ArtplayerType | null>(null)
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onPlayRef = useRef(onPlay)
  const onPauseRef = useRef(onPause)
  const onErrorRef = useRef(onError)
  const mediaSrc = useMemo(() => combinationApiResource(src), [src])
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const {
    chapters,
    duration: chaptersDuration,
    loading: chaptersLoading,
    error: chaptersError
  } = useVideoChapters(chaptersUrl)
  const currentChapter = useCurrentChapter(chapters, currentTime)
  const chapterMarkers = useMemo(() => createChapterTimelineMarkers(chapters), [chapters])
  const showDesktopChapterPanel = isDesktop && (chapters.length > 0 || chaptersLoading || !!chaptersError)
  const showCompactChapterRow = !isDesktop && (chaptersLoading || !!chaptersError || chapters.length > 0)
  const chapterUiDuration = duration > 0 ? duration : chaptersDuration
  const progress = duration > 0 && Number.isFinite(duration) ? (currentTime / duration) * 100 : 0

  const clearLoading = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current)
      loadingTimeoutRef.current = null
    }
    setLoading(false)
  }

  const shouldShowBuffering = (video?: HTMLVideoElement | null) => {
    if (!video) {
      return false
    }

    return !video.ended && !video.paused && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
  }

  const showVideoError = (message = '视频加载失败') => {
    setError(message)
    setLoading(false)
    onErrorRef.current?.(message)
  }

  const getArtVideo = (art: ArtplayerType | null) => {
    const currentArt = art as
      | (ArtplayerType & { video?: HTMLVideoElement; template?: { $video?: HTMLVideoElement } })
      | null
    return currentArt?.video ?? currentArt?.template?.$video ?? null
  }

  const getArtProgress = (art: ArtplayerType | null) => {
    const currentArt = art as (ArtplayerType & { template?: { $progress?: HTMLDivElement } }) | null
    return currentArt?.template?.$progress ?? null
  }

  const seekTo = (seconds: number) => {
    const art = artRef.current
    if (!art) return

    const artDuration = Number.isFinite(art.duration) && art.duration > 0 ? art.duration : duration

    const nextTime =
      Number.isFinite(artDuration) && artDuration > 0
        ? Math.min(Math.max(seconds, 0), artDuration)
        : Math.max(seconds, 0)

    art.currentTime = nextTime
    setCurrentTime(nextTime)
  }

  const seekToChapter = (chapter: NormalizedChapter) => {
    seekTo(chapter.start)
  }

  useEffect(() => {
    onPlayRef.current = onPlay
    onPauseRef.current = onPause
    onErrorRef.current = onError
  }, [onPlay, onPause, onError])

  useEffect(() => {
    hasStartedPlayingRef.current = false
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setError(null)
    setLoading(true)
    setAspectRatio('16 / 9')
    setChapterDrawerOpen(false)
    setArtInstance(null)
    setProgressPortalTarget(null)
  }, [mediaSrc])

  useEffect(() => {
    let active = true
    let instance: ArtplayerType | null = null

    async function initPlayer() {
      if (!playerContainerRef.current) {
        return
      }

      const { default: Artplayer } = await import('artplayer')
      if (!active || !playerContainerRef.current) {
        return
      }

      instance = new Artplayer({
        container: playerContainerRef.current,
        url: mediaSrc,
        autoplay: autoPlay,
        autoSize: false,
        loop,
        muted,
        setting: true,
        playbackRate: true,
        fullscreen: true,
        fullscreenWeb: true,
        pip: true,
        mutex: true,
        theme: '#3b82f6',
        moreVideoAttr: {
          preload,
          playsInline: true
        }
      })

      const art = instance
      artRef.current = art
      setArtInstance(art)
      setProgressPortalTarget(getArtProgress(art))

      const syncMetadata = () => {
        const video = getArtVideo(art)
        const nextDuration = Number.isFinite(art.duration) ? art.duration : (video?.duration ?? 0)

        setDuration(nextDuration > 0 ? nextDuration : 0)

        if (video?.videoWidth && video.videoHeight) {
          setAspectRatio(`${video.videoWidth} / ${video.videoHeight}`)
        }
      }

      const hideControls = () => {
        art.controls.show = false
      }

      art.on('ready', () => {
        syncMetadata()
        clearLoading()
        hideControls()
      })

      art.on('play', () => {
        setIsPlaying(true)
        hasStartedPlayingRef.current = true
        onPlayRef.current?.()
        hideControls()
      })

      art.on('pause', () => {
        const video = getArtVideo(art)
        setIsPlaying(false)
        onPauseRef.current?.()
        art.controls.show = true
        if (video?.readyState && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          clearLoading()
        }
      })

      art.on('ended', () => {
        clearLoading()
        setIsPlaying(false)
      })

      art.on('video:loadedmetadata', syncMetadata)
      art.on('video:loadeddata', clearLoading)
      art.on('video:canplay', clearLoading)
      art.on('video:canplaythrough', clearLoading)
      art.on('video:timeupdate', () => {
        const nextTime = Number.isFinite(art.currentTime) ? art.currentTime : 0
        setCurrentTime(nextTime)

        const video = getArtVideo(art)
        if (video?.readyState && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          clearLoading()
        }
      })
      art.on('video:loadstart', () => {
        setLoading(true)
      })
      art.on('video:waiting', () => {
        if (hasStartedPlayingRef.current && shouldShowBuffering(getArtVideo(art))) {
          setLoading(true)
        }
      })
      art.on('video:playing', () => {
        clearLoading()
        hasStartedPlayingRef.current = true
        hideControls()
      })
      art.on('error', () => {
        showVideoError()
      })
      art.on('video:error', () => {
        showVideoError()
      })
    }

    initPlayer().catch(() => {
      if (active) {
        showVideoError('播放器初始化失败')
      }
    })

    return () => {
      active = false
      setArtInstance(null)
      setProgressPortalTarget(null)
      if (instance) {
        instance.destroy(false)
      }
      if (artRef.current === instance) {
        artRef.current = null
      }
    }
  }, [autoPlay, loop, mediaSrc, muted, preload])

  useEffect(() => {
    const video = getArtVideo(artRef.current)
    if (!loading || !video) return

    loadingTimeoutRef.current = setTimeout(() => {
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA || video.ended || video.paused) {
        setLoading(false)
      }
      loadingTimeoutRef.current = null
    }, 8000)

    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
        loadingTimeoutRef.current = null
      }
    }
  }, [loading])

  useEffect(() => {
    if (!progressPortalTarget) {
      return
    }

    const previousPosition = progressPortalTarget.style.position
    if (!previousPosition) {
      progressPortalTarget.style.position = 'relative'
    }

    return () => {
      progressPortalTarget.style.position = previousPosition
    }
  }, [progressPortalTarget])

  useEffect(() => {
    if (!artInstance) {
      return
    }

    if (artInstance.controls[mobileChapterControlName]) {
      artInstance.controls.remove(mobileChapterControlName)
    }

    if (isDesktop || chapters.length === 0) {
      return
    }

    artInstance.controls.add({
      name: mobileChapterControlName,
      position: 'right',
      index: 20,
      html: '章节',
      tooltip: '章节',
      style: {
        padding: '0 10px',
        fontSize: '13px',
        color: 'var(--art-theme)'
      },
      mounted(element) {
        element.classList.add('art-control-chapter-entry')
      },
      click() {
        setChapterDrawerOpen(true)
      }
    })

    return () => {
      if (artInstance.controls[mobileChapterControlName]) {
        artInstance.controls.remove(mobileChapterControlName)
      }
    }
  }, [artInstance, chapters.length, isDesktop, mobileChapterControlName])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (loadingTimeoutRef.current) {
        clearTimeout(loadingTimeoutRef.current)
      }
    }
  }, [])

  if (error) {
    return (
      <div className={cn('flex flex-col items-center justify-center bg-neutral-100 text-neutral-600', className)}>
        <InfoIcon className="text-neutral-400 w-16 h-16 mb-4" />
        <p className="text-sm">{error}</p>
        <p className="text-xs text-neutral-500 mt-1">请检查视频文件是否存在或格式是否支持</p>
      </div>
    )
  }

  return (
    <div className={cn('video-player', className)}>
      <div className={cn('flex flex-col', showDesktopChapterPanel && 'lg:flex-row lg:items-stretch lg:gap-3')}>
        <div className="min-w-0 flex-1">
          <div className="relative overflow-hidden bg-black" style={{ aspectRatio }}>
            <div ref={playerContainerRef} className="h-full w-full" />

            {/* 加载指示器 */}
            {loading && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35">
                <div className="rounded-full bg-white/90 p-4">
                  <Loader2Icon className="h-8 w-8 animate-spin text-neutral-600" />
                </div>
              </div>
            )}
          </div>

          {showCompactChapterRow && (
            <div className="mt-2 min-w-0 text-xs text-neutral-500">
              <div className="min-w-0">
                {chaptersLoading
                  ? '章节加载中...'
                  : chaptersError
                    ? '章节加载失败'
                    : chapters.length > 0
                      ? `${chapters.length} 段章节`
                      : ''}
              </div>
            </div>
          )}

          {duration > 0 && (
            <div className="mt-2 text-right text-[11px] tabular-nums text-neutral-500">
              {isPlaying ? '播放中' : '已暂停'}
              {chapterMarkers.length > 0 ? ` · ${Math.round(progress)}%` : ''}
              {' · '}
              {formatChapterTime(currentTime)} / {formatChapterTime(duration)}
            </div>
          )}
        </div>

        {showDesktopChapterPanel && (
          <div className="mt-3 lg:mt-0 lg:w-72 lg:shrink-0">
            {chaptersLoading ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-4 text-sm text-neutral-500">
                章节加载中...
              </div>
            ) : chaptersError ? (
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3 py-4 text-sm text-neutral-500">
                章节加载失败
              </div>
            ) : (
              <div
                className={cn(
                  'rounded-lg border border-neutral-200 bg-white p-2',
                  currentChapter?.id ? 'shadow-sm shadow-neutral-200/70' : ''
                )}
              >
                <ChapterSidebar
                  chapters={chapters}
                  currentChapterId={currentChapter?.id}
                  onChapterClick={seekToChapter}
                  tone="light"
                  className="border-none bg-transparent"
                />
              </div>
            )}
          </div>
        )}
      </div>

      {!loading &&
        progressPortalTarget &&
        chapterMarkers.length > 0 &&
        chapterUiDuration > 0 &&
        createPortal(
          <div className="pointer-events-none absolute inset-0 z-20">
            <TimelineMarkers
              markers={chapterMarkers}
              duration={chapterUiDuration}
              onMarkerClick={(marker) => seekTo(marker.time)}
              className="inset-0"
              markerClassName="h-3"
              lineClassName="h-1.5 bg-white/80"
              tooltipSide="top"
            />
          </div>,
          progressPortalTarget
        )}

      {!isDesktop && chapters.length > 0 && (
        <ChapterDrawer
          chapters={chapters}
          currentChapterId={currentChapter?.id}
          onChapterClick={seekToChapter}
          open={chapterDrawerOpen}
          onOpenChange={setChapterDrawerOpen}
          showTrigger={false}
        />
      )}
    </div>
  )
}

export default VideoPlayer
