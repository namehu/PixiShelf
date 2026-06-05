'use client'

import { InfoIcon, Loader2Icon, XIcon } from 'lucide-react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import type ArtplayerType from 'artplayer'
import { motion, AnimatePresence } from 'framer-motion'
import ChapterSidebar from '@/components/players/ChapterSidebar'
import TimelineMarkers from '@/components/players/TimelineMarkers'
import { useCurrentChapter } from '@/components/players/use-current-chapter'
import { useVideoChapters } from '@/components/players/use-video-chapters'
import { createChapterTimelineMarkers, type NormalizedChapter } from '@/components/players/video-chapters'
import { useMediaQuery } from '@/hooks/use-media-query'
import { cn } from '@/lib/utils'
import { combinationApiResource } from '@/utils/combinationStatic'

const VIDEO_TIME_SYNC_THRESHOLD = 0.25

export function shouldShowVideoBuffering(video?: HTMLVideoElement | null) {
  if (!video) {
    return false
  }

  return !video.ended && !video.paused && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
}

export function shouldSyncVideoTime(previousTime: number, nextTime: number) {
  return Math.abs(nextTime - previousTime) >= VIDEO_TIME_SYNC_THRESHOLD
}

export interface VideoPlayerProps {
  src: string
  chaptersUrl?: string | null
  autoPlay?: boolean
  loop?: boolean
  muted?: boolean
  preload?: 'none' | 'metadata' | 'auto'
  className?: string
  fillParent?: boolean
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
  fillParent = false,
  onPlay,
  onPause,
  onError
}: VideoPlayerProps) {
  const mobileChapterControlName = 'chapter-entry'
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState('16 / 9')
  const [showChapterOverlay, setShowChapterOverlay] = useState(false)
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
  const { chapters, duration: chaptersDuration } = useVideoChapters(chaptersUrl)
  const currentChapter = useCurrentChapter(chapters, currentTime)
  const chapterMarkers = useMemo(() => createChapterTimelineMarkers(chapters), [chapters])
  const chapterUiDuration = duration > 0 ? duration : chaptersDuration

  const clearLoading = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current)
      loadingTimeoutRef.current = null
    }
    setLoading(false)
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
    setCurrentTime(0)
    setDuration(0)
    setError(null)
    setLoading(true)
    setAspectRatio('16 / 9')
    setShowChapterOverlay(false)
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
        hasStartedPlayingRef.current = true
        onPlayRef.current?.()
        hideControls()
      })

      art.on('pause', () => {
        const video = getArtVideo(art)
        onPauseRef.current?.()
        art.controls.show = true
        if (video?.readyState && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          clearLoading()
        }
      })

      art.on('ended', () => {
        clearLoading()
      })

      art.on('video:loadedmetadata', syncMetadata)
      art.on('video:loadeddata', clearLoading)
      art.on('video:canplay', clearLoading)
      art.on('video:canplaythrough', clearLoading)
      art.on('video:timeupdate', () => {
        const nextTime = Number.isFinite(art.currentTime) ? art.currentTime : 0
        setCurrentTime((previousTime) => (shouldSyncVideoTime(previousTime, nextTime) ? nextTime : previousTime))

        const video = getArtVideo(art)
        if (video?.readyState && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          clearLoading()
        }
      })
      art.on('video:loadstart', () => {
        setLoading(true)
      })
      art.on('video:waiting', () => {
        if (hasStartedPlayingRef.current && shouldShowVideoBuffering(getArtVideo(art))) {
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

    if (chapters.length === 0) {
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
        setShowChapterOverlay((prev) => !prev)
      }
    })

    return () => {
      if (artInstance.controls[mobileChapterControlName]) {
        artInstance.controls.remove(mobileChapterControlName)
      }
    }
  }, [artInstance, chapters.length, mobileChapterControlName])

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
    <div
      className={cn('video-player relative flex items-center justify-center bg-black', className)}
      style={fillParent ? undefined : { aspectRatio, width: '100%', maxWidth: '100%', maxHeight: '100%' }}
    >
      <div ref={playerContainerRef} className="h-full w-full" />

      {/* 加载指示器 */}
      {loading && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/35">
          <div className="rounded-full bg-white/90 p-4">
            <Loader2Icon className="h-8 w-8 animate-spin text-neutral-600" />
          </div>
        </div>
      )}

      {/* 章节浮层放在播放器外层，避免被 Artplayer 控制条和居中播放按钮遮挡。 */}
      <AnimatePresence>
        {showChapterOverlay && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50"
          >
            <button
              type="button"
              aria-label="关闭章节列表"
              className="absolute inset-0 cursor-default border-0 bg-black/20 p-0"
              onClick={() => setShowChapterOverlay(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.18, ease: 'easeOut' }}
              className="absolute bottom-0 right-0 top-0 flex w-64 max-w-full flex-col border-l border-white/10 bg-black/90 shadow-2xl backdrop-blur-xl sm:w-80"
            >
              <div className="flex items-center justify-between border-b border-white/10 p-2">
                <div>
                  <span className="font-medium text-white">章节</span>
                  <span className="ml-2 text-xs text-white/60">{chapters.length} 段</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowChapterOverlay(false)}
                  className="rounded-md p-1.5 text-white/60 transition-colors hover:bg-white/10 hover:text-white"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>
              <div className="flex-1 overflow-hidden">
                <ChapterSidebar
                  chapters={chapters}
                  currentChapterId={currentChapter?.id}
                  onChapterClick={(c) => {
                    seekToChapter(c)
                    if (!isDesktop) setShowChapterOverlay(false)
                  }}
                  tone="dark"
                  className="h-full rounded-none border-none bg-transparent"
                  scrollAreaClassName="h-full"
                />
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

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
    </div>
  )
}

export default VideoPlayer
