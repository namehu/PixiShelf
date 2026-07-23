'use client'

import { InfoIcon, ListVideoIcon, Loader2Icon, SkipBackIcon, SkipForwardIcon, Volume2Icon, XIcon } from 'lucide-react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type ArtplayerType from 'artplayer'
import { motion, AnimatePresence } from 'framer-motion'
import ChapterSidebar from '@/components/players/ChapterSidebar'
import TimelineMarkers from '@/components/players/TimelineMarkers'
import { useCurrentChapter } from '@/components/players/use-current-chapter'
import { useVideoChapters } from '@/components/players/use-video-chapters'
import {
  createChapterTimelineMarkers,
  getAdjacentChapters,
  type NormalizedChapter
} from '@/components/players/video-chapters'
import { useMediaQuery } from '@/hooks/use-media-query'
import { createArtplayerCleanup } from '@/lib/artplayer-lifecycle'
import { cn } from '@/lib/utils'
import { combinationApiResource } from '@/utils/combinationStatic'
import { formatFileSize } from '@/utils/media'
import './VideoPlayer.css'

const VIDEO_TIME_SYNC_THRESHOLD = 0.25
const CHAPTER_CONTROL_VISIBILITY_DURATION = 1200

export function shouldShowVideoBuffering(video?: HTMLVideoElement | null) {
  if (!video) {
    return false
  }

  return !video.ended && !video.paused && video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA
}

export function shouldSyncVideoTime(previousTime: number, nextTime: number) {
  return Math.abs(nextTime - previousTime) >= VIDEO_TIME_SYNC_THRESHOLD
}

export function shouldShowAudioControls(hasAudio?: boolean | null) {
  return hasAudio === true
}

export function formatVideoRemainingTime(duration: number, currentTime: number) {
  if (!Number.isFinite(duration) || duration <= 0) {
    return '--:--'
  }

  const totalSeconds = Math.max(0, Math.ceil(duration - Math.max(currentTime, 0)))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const paddedSeconds = String(seconds).padStart(2, '0')

  return hours > 0 ? `${hours}:${String(minutes).padStart(2, '0')}:${paddedSeconds}` : `${minutes}:${paddedSeconds}`
}

export interface VideoPlayerProps {
  src: string
  chaptersUrl?: string | null
  hasAudio?: boolean | null
  size?: number | null
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
  hasAudio,
  size,
  autoPlay = false,
  loop = true,
  muted = false,
  preload = 'metadata',
  className = '',
  fillParent = false,
  onPlay,
  onPause,
  onError
}: VideoPlayerProps) {
  const previousChapterControlName = 'chapter-previous'
  const nextChapterControlName = 'chapter-next'
  const chapterControlName = 'chapter-entry'
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState('16 / 9')
  const [showChapterOverlay, setShowChapterOverlay] = useState(false)
  const [isPlaying, setIsPlaying] = useState(false)
  const [artInstance, setArtInstance] = useState<ArtplayerType | null>(null)
  const [progressPortalTarget, setProgressPortalTarget] = useState<HTMLDivElement | null>(null)
  const hasStartedPlayingRef = useRef(false)
  const playerContainerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<ArtplayerType | null>(null)
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const keepControlsVisibleUntilRef = useRef(0)
  const onPlayRef = useRef(onPlay)
  const onPauseRef = useRef(onPause)
  const onErrorRef = useRef(onError)
  const mediaSrc = useMemo(() => combinationApiResource(src), [src])
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const { chapters, duration: chaptersDuration } = useVideoChapters(chaptersUrl)
  const currentChapter = useCurrentChapter(chapters, currentTime)
  const { previous: previousChapter, next: nextChapter } = useMemo(
    () => getAdjacentChapters(chapters, currentTime),
    [chapters, currentTime]
  )
  const chapterMarkers = useMemo(() => createChapterTimelineMarkers(chapters), [chapters])
  const chapterUiDuration = duration > 0 ? duration : chaptersDuration
  const chapterMarkerMinSpacingPx = isDesktop ? 18 : 28
  const showAudioControls = shouldShowAudioControls(hasAudio)
  const showVideoMetadataTag = (size ?? 0) > 0 || showAudioControls

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
    const progress = currentArt?.template?.$progress
    return progress?.querySelector<HTMLDivElement>('.art-control-progress') ?? progress ?? null
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
    setIsPlaying(false)
    setArtInstance(null)
    setProgressPortalTarget(null)
    keepControlsVisibleUntilRef.current = 0
  }, [mediaSrc])

  useEffect(() => {
    let active = true
    let instance: ArtplayerType | null = null
    let cleanupPlayer: (() => void) | null = null

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
        muted: showAudioControls ? muted : true,
        setting: true,
        playbackRate: true,
        fullscreen: true,
        fullscreenWeb: true,
        pip: false,
        mutex: true,
        gesture: false,
        theme: '#3b82f6',
        moreVideoAttr: {
          preload,
          playsInline: true
        }
      })

      const art = instance
      artRef.current = art
      cleanupPlayer = createArtplayerCleanup(art, playerContainerRef.current)
      setArtInstance(art)
      setProgressPortalTarget(getArtProgress(art))

      if (!showAudioControls) {
        const player = (art as ArtplayerType & { template?: { $player?: HTMLDivElement } }).template?.$player
        player?.classList.add('art-audio-controls-hidden')
        const controls = art.controls as ArtplayerType['controls'] & { volume?: unknown }
        if (controls.volume) {
          controls.remove('volume')
        }
      }

      const syncMetadata = () => {
        const video = getArtVideo(art)
        const nextDuration = Number.isFinite(art.duration) ? art.duration : (video?.duration ?? 0)

        setDuration(nextDuration > 0 ? nextDuration : 0)

        if (video?.videoWidth && video.videoHeight) {
          setAspectRatio(`${video.videoWidth} / ${video.videoHeight}`)
        }
      }

      const updateRemainingTime = () => {
        const player = (art as ArtplayerType & { template?: { $player?: HTMLDivElement } }).template?.$player
        const timeControl = player?.querySelector<HTMLElement>('.art-control-time')

        if (timeControl) {
          timeControl.textContent = formatVideoRemainingTime(art.duration, art.currentTime)
        }
      }

      const hideControls = () => {
        if (Date.now() < keepControlsVisibleUntilRef.current) {
          art.controls.show = true
          return
        }

        art.controls.show = false
      }

      art.on('ready', () => {
        syncMetadata()
        updateRemainingTime()
        setProgressPortalTarget(getArtProgress(art))
        clearLoading()
        hideControls()
      })

      art.on('play', () => {
        // Default playback is initiated by the user, so audio tracks should not
        // remain muted because of an earlier autoplay-oriented configuration.
        if (showAudioControls && !autoPlay) {
          art.muted = false
        }

        hasStartedPlayingRef.current = true
        setIsPlaying(true)
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
        setIsPlaying(false)
        clearLoading()
      })

      art.on('video:loadedmetadata', () => {
        syncMetadata()
        updateRemainingTime()
      })
      art.on('video:progress', updateRemainingTime)
      art.on('video:loadeddata', clearLoading)
      art.on('video:canplay', clearLoading)
      art.on('video:canplaythrough', clearLoading)
      art.on('video:timeupdate', () => {
        const nextTime = Number.isFinite(art.currentTime) ? art.currentTime : 0
        setCurrentTime((previousTime) => (shouldSyncVideoTime(previousTime, nextTime) ? nextTime : previousTime))
        updateRemainingTime()

        const video = getArtVideo(art)
        if (video?.readyState && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          clearLoading()
        }
      })
      art.on('video:loadstart', () => {
        if (shouldShowVideoBuffering(getArtVideo(art))) {
          setLoading(true)
        }
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
      cleanupPlayer?.()
      if (artRef.current === instance) {
        artRef.current = null
      }
    }
  }, [autoPlay, loop, mediaSrc, muted, preload, showAudioControls])

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

    const controlNames = [previousChapterControlName, nextChapterControlName, chapterControlName]
    const controlRoots = new Map<string, Root>()

    const unmountControlRoot = (name: string) => {
      const root = controlRoots.get(name)
      controlRoots.delete(name)

      // Artplayer may remove controls while React is committing this component's
      // cleanup. Deferring the nested root avoids synchronously unmounting a root
      // during an active React render.
      if (root) {
        window.setTimeout(() => root.unmount(), 0)
      }
    }

    controlNames.forEach((name) => {
      if (artInstance.controls[name]) {
        artInstance.controls.remove(name)
      }
    })

    if (chapters.length === 0) {
      return
    }

    const addChapterNavigationControl = ({
      name,
      chapter,
      label,
      icon,
      index,
      disabled
    }: {
      name: string
      chapter?: NormalizedChapter
      label: string
      icon: React.ReactNode
      index: number
      disabled: boolean
    }) => {
      artInstance.controls.add({
        name,
        position: 'right',
        index,
        html: '',
        tooltip: label,
        style: {
          padding: '0 10px',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? '0.35' : '1'
        },
        mounted(element) {
          element.classList.add('art-control-chapter-navigation')
          element.classList.toggle('art-control-chapter-navigation-disabled', disabled)
          element.setAttribute('aria-label', label)
          element.setAttribute('aria-disabled', String(disabled))
          const root = createRoot(element)
          controlRoots.set(name, root)
          root.render(icon)
        },
        beforeUnmount() {
          unmountControlRoot(name)
        },
        click(_, event) {
          event.stopPropagation()
          if (!chapter) {
            return
          }

          keepControlsVisibleUntilRef.current = Date.now() + CHAPTER_CONTROL_VISIBILITY_DURATION
          artInstance.controls.show = true
          seekToChapter(chapter)
        }
      })
    }

    addChapterNavigationControl({
      name: previousChapterControlName,
      chapter: previousChapter,
      label: previousChapter ? `上一章：${previousChapter.title}` : '已经是第一章',
      icon: <SkipBackIcon aria-hidden="true" className="h-5 w-5" />,
      index: 18,
      disabled: !previousChapter
    })

    addChapterNavigationControl({
      name: nextChapterControlName,
      chapter: nextChapter,
      label: nextChapter ? `下一章：${nextChapter.title}` : '已经是最后一章',
      icon: <SkipForwardIcon aria-hidden="true" className="h-5 w-5" />,
      index: 19,
      disabled: !nextChapter
    })

    artInstance.controls.add({
      name: chapterControlName,
      position: 'right',
      index: 20,
      html: '',
      tooltip: '章节',
      style: {
        padding: '0 10px'
      },
      mounted(element) {
        element.classList.add('art-control-chapter-entry')
        element.setAttribute('aria-label', '章节')
        const root = createRoot(element)
        controlRoots.set(chapterControlName, root)
        root.render(<ListVideoIcon aria-hidden="true" className="h-5 w-5" />)
      },
      beforeUnmount() {
        unmountControlRoot(chapterControlName)
      },
      click(_, event) {
        event.stopPropagation()
        keepControlsVisibleUntilRef.current = Date.now() + CHAPTER_CONTROL_VISIBILITY_DURATION
        artInstance.controls.show = true
        setShowChapterOverlay((prev) => !prev)
      }
    })

    return () => {
      controlNames.forEach((name) => {
        if (artInstance.controls[name]) {
          artInstance.controls.remove(name)
        }
      })
    }
  }, [
    artInstance,
    chapterControlName,
    chapters.length,
    nextChapter,
    nextChapterControlName,
    previousChapter,
    previousChapterControlName
  ])

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

      {showVideoMetadataTag && !isPlaying && (
        <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {(size ?? 0) > 0 && (
            <span>{formatFileSize(size ?? 0)}</span>
          )}
          {showAudioControls && <Volume2Icon aria-label="含音频" size={10} />}
        </div>
      )}

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
              minMarkerSpacingPx={chapterMarkerMinSpacingPx}
              className="inset-0"
              markerClassName="h-3"
              lineClassName="h-1.5 bg-white/80"
            />
          </div>,
          progressPortalTarget
        )}

    </div>
  )
}

export default VideoPlayer
