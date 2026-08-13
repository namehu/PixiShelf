'use client'

import {
  InfoIcon,
  ListVideoIcon,
  Loader2Icon,
  RotateCcwIcon,
  SkipBackIcon,
  SkipForwardIcon,
  Volume2Icon
} from 'lucide-react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { createRoot, type Root } from 'react-dom/client'
import type ArtplayerType from 'artplayer'
import ChapterTimelinePreview from '@/components/players/chapter-timeline-preview'
import ChapterAudioTrack from '@/components/players/chapter-audio-track'
import TimelineMarkers from '@/components/players/timeline-markers'
import {
  createChapterOverlayPlugin,
  getChapterOverlayPlugin,
  type ChapterOverlayPortal,
  type ChapterOverlayPluginApi
} from '@/components/players/artplayer-chapter-overlay-plugin'
import { useCurrentChapter } from '@/components/players/use-current-chapter'
import { useVideoChapters } from '@/components/players/use-video-chapters'
import { useVideoKeyframes } from '@/components/players/use-video-keyframes'
import {
  createChapterTimelineMarkers,
  getAdjacentChapters,
  getCurrentChapter,
  type NormalizedChapter
} from '@/components/players/video-chapters'
import { getNearestVideoKeyframe } from '@/components/players/video-keyframes'
import { useMediaQuery } from '@/hooks/use-media-query'
import { useVideoLongPressPlaybackRate, useVideoSeekStepSeconds } from '@/components/user-setting'
import { Button } from '@/components/ui/button'
import { createArtplayerCleanup } from '@/lib/artplayer-lifecycle'
import { cn } from '@/lib/utils'
import { combinationApiResource } from '@/utils/combination-static'
import { formatFileSize } from '@/utils/media'
import {
  createVideoInteractionPlugin,
  getVideoInteractionPlugin,
  type VideoInteractionFeedback,
  type VideoInteractionPluginApi
} from '@/components/players/video-interaction-controller'
import './video-player.css'

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

export interface VideoPlayerSettingAction {
  name: string
  label: string
  tooltip?: string
  disabled?: boolean
  onClick?: () => void
}

export interface VideoPlayerProps {
  src: string
  chaptersUrl?: string | null
  chaptersCount?: number
  keyframesUrl?: string | null
  keyframeCount?: number
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
  settingActions?: VideoPlayerSettingAction[]
}

export function VideoPlayer({
  src,
  chaptersUrl,
  chaptersCount: chapterCountHint = 0,
  keyframesUrl,
  keyframeCount: keyframeCountHint = 0,
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
  onError,
  settingActions
}: VideoPlayerProps) {
  const previousChapterControlName = 'chapter-previous'
  const nextChapterControlName = 'chapter-next'
  const chapterControlName = 'chapter-entry'
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [aspectRatio, setAspectRatio] = useState('16 / 9')
  const [isPlaying, setIsPlaying] = useState(false)
  const [isFullscreenWeb, setIsFullscreenWeb] = useState(false)
  const [artInstance, setArtInstance] = useState<ArtplayerType | null>(null)
  const [progressPortalTarget, setProgressPortalTarget] = useState<HTMLDivElement | null>(null)
  const [chapterOverlayPortal, setChapterOverlayPortal] = useState<ChapterOverlayPortal | null>(null)
  const [timelinePreviewChapterId, setTimelinePreviewChapterId] = useState<string | null>(null)
  const [gestureFeedback, setGestureFeedback] = useState<VideoInteractionFeedback | null>(null)
  const [playerAttempt, setPlayerAttempt] = useState(0)
  const hasStartedPlayingRef = useRef(false)
  const playerContainerRef = useRef<HTMLDivElement>(null)
  const artRef = useRef<ArtplayerType | null>(null)
  const chapterOverlayPluginRef = useRef<ChapterOverlayPluginApi | null>(null)
  const videoInteractionPluginRef = useRef<VideoInteractionPluginApi | null>(null)
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const controlsVisibleRef = useRef(true)
  const chaptersRef = useRef<NormalizedChapter[]>([])
  const lastConfirmedTimeRef = useRef(0)
  const wasPlayingBeforeErrorRef = useRef(false)
  const errorRetrySnapshotRef = useRef({ time: 0, shouldPlay: false })
  const pendingRetryRef = useRef<{ time: number; shouldPlay: boolean } | null>(null)
  const onPlayRef = useRef(onPlay)
  const onPauseRef = useRef(onPause)
  const onErrorRef = useRef(onError)
  const mediaSrc = useMemo(() => combinationApiResource(src), [src])
  const longPressPlaybackRate = useVideoLongPressPlaybackRate()
  const seekStepSeconds = useVideoSeekStepSeconds()
  const isDesktop = useMediaQuery('(min-width: 1024px)')
  const {
    chapters,
    duration: chaptersDuration,
    loading: chaptersLoading,
    loaded: chaptersLoaded,
    error: chaptersError,
    reload: reloadChapters
  } = useVideoChapters(chaptersUrl)
  const {
    keyframes,
    loading: keyframesLoading,
    loaded: keyframesLoaded,
    error: keyframesError,
    reload: reloadKeyframes
  } = useVideoKeyframes(keyframesUrl)
  const currentChapter = useCurrentChapter(chapters, currentTime)
  const currentKeyframe = useMemo(() => getNearestVideoKeyframe(keyframes, currentTime), [keyframes, currentTime])
  const { previous: previousChapter, next: nextChapter } = useMemo(
    () => getAdjacentChapters(chapters, currentTime),
    [chapters, currentTime]
  )
  const chapterMarkers = useMemo(() => createChapterTimelineMarkers(chapters), [chapters])
  const chaptersAvailable =
    chapters.length > 0 || (Boolean(chaptersUrl) && (!chaptersLoaded || chaptersLoading || Boolean(chaptersError)))
  const keyframesAvailable =
    keyframes.length > 0 || (Boolean(keyframesUrl) && (!keyframesLoaded || keyframesLoading || Boolean(keyframesError)))
  const chapterCount = chapters.length || chapterCountHint
  const keyframeCount = keyframes.length || keyframeCountHint
  const chapterUiDuration = duration > 0 ? duration : chaptersDuration
  const chapterMarkerMinSpacingPx = isDesktop ? 18 : 28
  const showAudioControls = shouldShowAudioControls(hasAudio)
  const showVideoMetadataTag = (size ?? 0) > 0 || showAudioControls

  useEffect(() => {
    chaptersRef.current = chapters
  }, [chapters])

  const clearLoading = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current)
      loadingTimeoutRef.current = null
    }
    setLoading(false)
  }

  const showVideoError = (message = '视频加载失败') => {
    const art = artRef.current
    if (art && Number.isFinite(art.currentTime)) {
      lastConfirmedTimeRef.current = Math.max(art.currentTime, 0)
    }
    errorRetrySnapshotRef.current = {
      time: lastConfirmedTimeRef.current,
      shouldPlay: wasPlayingBeforeErrorRef.current
    }
    setError(message)
    setLoading(false)
    setIsPlaying(false)
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
    setIsPlaying(false)
    setIsFullscreenWeb(false)
    setArtInstance(null)
    setProgressPortalTarget(null)
    setChapterOverlayPortal(null)
    setTimelinePreviewChapterId(null)
    setGestureFeedback(null)
    controlsVisibleRef.current = true
    lastConfirmedTimeRef.current = 0
    wasPlayingBeforeErrorRef.current = false
    errorRetrySnapshotRef.current = { time: 0, shouldPlay: false }
    pendingRetryRef.current = null
  }, [mediaSrc])

  useEffect(() => {
    let active = true
    let instance: ArtplayerType | null = null
    let cleanupPlayer: (() => void) | null = null
    let handleFullscreenWeb: ((enabled: boolean) => void) | null = null
    let handleControl: ((visible: boolean) => void) | null = null

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
        settings: (settingActions ?? []).map((action) => ({
          name: action.name,
          html: action.label,
          tooltip: action.tooltip,
          onClick(this: ArtplayerType) {
            if (!action.disabled) action.onClick?.()
            this.setting.show = false
            return action.tooltip
          }
        })),
        playbackRate: true,
        fullscreen: true,
        fullscreenWeb: true,
        pip: false,
        mutex: true,
        gesture: false,
        theme: '#3b82f6',
        plugins: [
          createVideoInteractionPlugin({
            longPressRate: longPressPlaybackRate,
            seekStepSeconds,
            getChapterAt: (time) => getCurrentChapter(chaptersRef.current, time),
            onFeedback: (feedback) => {
              if (active) setGestureFeedback(feedback)
            },
            setControlsVisible: (visible) => {
              controlsVisibleRef.current = visible
              if (instance) instance.controls.show = visible
            },
            getControlsVisible: () => controlsVisibleRef.current
          }),
          createChapterOverlayPlugin(setChapterOverlayPortal)
        ],
        moreVideoAttr: {
          preload,
          playsInline: true
        }
      })

      const art = instance
      artRef.current = art
      cleanupPlayer = createArtplayerCleanup(art, playerContainerRef.current)
      videoInteractionPluginRef.current = getVideoInteractionPlugin(art)
      chapterOverlayPluginRef.current = getChapterOverlayPlugin(art)
      setArtInstance(art)
      setIsFullscreenWeb(Boolean(art.fullscreenWeb))
      setProgressPortalTarget(getArtProgress(art))

      handleFullscreenWeb = (enabled: boolean) => {
        if (active) setIsFullscreenWeb(Boolean(enabled))
      }
      art.on('fullscreenWeb', handleFullscreenWeb)

      handleControl = (visible: boolean) => {
        if (Boolean(visible) !== controlsVisibleRef.current) {
          art.controls.show = controlsVisibleRef.current
        }
      }
      art.on('control', handleControl)

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

      art.on('ready', () => {
        syncMetadata()
        updateRemainingTime()
        setProgressPortalTarget(getArtProgress(art))
        controlsVisibleRef.current = true
        art.controls.show = true
        clearLoading()

        const retry = pendingRetryRef.current
        pendingRetryRef.current = null
        if (retry) {
          art.currentTime = Math.min(Math.max(retry.time, 0), art.duration || retry.time)
          if (retry.shouldPlay) void art.play().catch(() => undefined)
        }
      })

      art.on('play', () => {
        // Default playback is initiated by the user, so audio tracks should not
        // remain muted because of an earlier autoplay-oriented configuration.
        if (showAudioControls && !autoPlay) {
          art.muted = false
        }

        hasStartedPlayingRef.current = true
        wasPlayingBeforeErrorRef.current = true
        setIsPlaying(true)
        onPlayRef.current?.()
      })

      art.on('pause', () => {
        const video = getArtVideo(art)
        wasPlayingBeforeErrorRef.current = false
        setIsPlaying(false)
        onPauseRef.current?.()
        if (video?.readyState && video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
          clearLoading()
        }
      })

      art.on('ended', () => {
        wasPlayingBeforeErrorRef.current = false
        setIsPlaying(false)
        controlsVisibleRef.current = true
        art.controls.show = true
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
          lastConfirmedTimeRef.current = Math.max(nextTime, 0)
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
        wasPlayingBeforeErrorRef.current = true
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
      setIsFullscreenWeb(false)
      setProgressPortalTarget(null)
      if (instance && handleFullscreenWeb) {
        instance.off('fullscreenWeb', handleFullscreenWeb)
      }
      if (instance && handleControl) {
        instance.off('control', handleControl)
      }
      const videoInteractionPlugin = videoInteractionPluginRef.current
      videoInteractionPluginRef.current = null
      videoInteractionPlugin?.destroy()
      const chapterOverlayPlugin = chapterOverlayPluginRef.current
      chapterOverlayPluginRef.current = null
      chapterOverlayPlugin?.destroy()
      cleanupPlayer?.()
      if (artRef.current === instance) {
        artRef.current = null
      }
    }
  }, [
    autoPlay,
    longPressPlaybackRate,
    loop,
    mediaSrc,
    muted,
    playerAttempt,
    preload,
    seekStepSeconds,
    settingActions,
    showAudioControls
  ])

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
    if (!artInstance) return

    chapterOverlayPluginRef.current?.update({
      chapters,
      chaptersAvailable,
      chapterCount,
      chaptersLoading,
      chaptersError,
      onChaptersRetry: reloadChapters,
      currentChapterId: currentChapter?.id,
      keyframes,
      keyframesAvailable,
      keyframeCount,
      keyframesLoading,
      keyframesError,
      onKeyframesRetry: reloadKeyframes,
      onKeyframesOpen: reloadKeyframes,
      currentKeyframeId: currentKeyframe?.id,
      mode: isDesktop ? 'desktop' : isFullscreenWeb ? 'mobile-fullweb' : 'mobile-sheet'
    })
  }, [
    artInstance,
    chapterCount,
    chapters,
    chaptersAvailable,
    chaptersError,
    chaptersLoading,
    currentChapter?.id,
    currentKeyframe?.id,
    isDesktop,
    isFullscreenWeb,
    keyframeCount,
    keyframes,
    keyframesAvailable,
    keyframesError,
    keyframesLoading,
    reloadChapters,
    reloadKeyframes
  ])

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

    if (!chaptersAvailable && !keyframesAvailable) {
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

          seekToChapter(chapter)
        }
      })
    }

    if (chapters.length > 0) {
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
    }

    const navigationLabel = chaptersAvailable && keyframesAvailable ? '视频导航' : keyframesAvailable ? '画面' : '章节'

    artInstance.controls.add({
      name: chapterControlName,
      position: 'right',
      index: 20,
      html: '',
      tooltip: navigationLabel,
      style: {
        padding: '0 10px'
      },
      mounted(element) {
        element.classList.add('art-control-chapter-entry')
        element.setAttribute('aria-label', navigationLabel)
        const root = createRoot(element)
        controlRoots.set(chapterControlName, root)
        root.render(<ListVideoIcon aria-hidden="true" className="h-5 w-5" />)
      },
      beforeUnmount() {
        unmountControlRoot(chapterControlName)
      },
      click(_, event) {
        event.stopPropagation()
        chapterOverlayPluginRef.current?.toggle()
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
    chaptersAvailable,
    keyframesAvailable,
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

  const retryVideo = (fromStart: boolean) => {
    pendingRetryRef.current = {
      time: fromStart ? 0 : errorRetrySnapshotRef.current.time,
      shouldPlay: errorRetrySnapshotRef.current.shouldPlay
    }
    setError(null)
    setLoading(true)
    setPlayerAttempt((attempt) => attempt + 1)
  }

  return (
    <div
      className={cn('video-player relative flex items-center justify-center bg-black', className)}
      style={fillParent ? undefined : { aspectRatio, width: '100%', maxWidth: '100%', maxHeight: '100%' }}
    >
      <div ref={playerContainerRef} className="h-full w-full" />

      {error && (
        <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-neutral-950/95 px-6 text-center text-white">
          <InfoIcon className="mb-3 h-14 w-14 text-neutral-400" aria-hidden="true" />
          <p className="text-sm font-medium">{error}</p>
          <p className="mt-1 text-xs text-neutral-400">可以从最后可播放位置重试，或从头重新加载</p>
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => retryVideo(false)}>
              <RotateCcwIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
              重新加载
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => retryVideo(true)}>
              从头加载
            </Button>
          </div>
        </div>
      )}

      {gestureFeedback && !error && (
        <div
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center px-6"
          role="status"
          aria-live="polite"
        >
          <div className="max-w-[80%] rounded-xl bg-black/75 px-4 py-3 text-center text-white shadow-xl backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in-0 motion-safe:zoom-in-95">
            <p className="text-sm font-semibold sm:text-base">{gestureFeedback.title}</p>
            {gestureFeedback.detail && <p className="mt-1 truncate text-xs text-white/70">{gestureFeedback.detail}</p>}
          </div>
        </div>
      )}

      {showVideoMetadataTag && !isPlaying && (
        <div className="pointer-events-none absolute right-2 top-2 z-20 flex items-center gap-1 rounded bg-black/50 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          {(size ?? 0) > 0 && <span>{formatFileSize(size ?? 0)}</span>}
          {showAudioControls && <Volume2Icon aria-label="含音频" size={10} />}
        </div>
      )}

      {/* 加载指示器 */}
      {loading && !error && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-black/35">
          <div className="rounded-full bg-white/90 p-4">
            <Loader2Icon className="h-8 w-8 animate-spin text-neutral-600" />
          </div>
        </div>
      )}

      {chapterOverlayPortal && createPortal(chapterOverlayPortal.content, chapterOverlayPortal.target)}

      {!loading &&
        progressPortalTarget &&
        chapterMarkers.length > 0 &&
        chapterUiDuration > 0 &&
        createPortal(
          <div className="pointer-events-none absolute inset-0 z-20">
            <ChapterAudioTrack chapters={chapters} duration={chapterUiDuration} />
            {isDesktop && (
              <ChapterTimelinePreview
                target={progressPortalTarget}
                chapters={chapters}
                duration={chapterUiDuration}
                forcedChapterId={timelinePreviewChapterId}
              />
            )}
            <TimelineMarkers
              markers={chapterMarkers}
              duration={chapterUiDuration}
              onMarkerClick={(marker) => seekTo(marker.time)}
              onMarkerPreviewChange={
                isDesktop ? (marker) => setTimelinePreviewChapterId(marker?.id ?? null) : undefined
              }
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
