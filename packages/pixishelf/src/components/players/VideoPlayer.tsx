'use client'

import { InfoIcon, Loader2Icon, PlayIcon } from 'lucide-react'
import React, { useState, useRef, useEffect, useMemo } from 'react'
import { cn } from '@/lib/utils'
import { combinationApiResource } from '@/utils/combinationStatic'

export interface VideoPlayerProps {
  src: string
  autoPlay?: boolean
  loop?: boolean
  preload?: 'none' | 'metadata' | 'auto'
  className?: string
  onPlay?: () => void
  onPause?: () => void
  onError?: (error: string) => void
}

export function VideoPlayer({
  src,
  autoPlay = true,
  loop = true,
  preload = 'metadata',
  className = '',
  onPlay,
  onPause,
  onError
}: VideoPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const hasStartedPlayingRef = useRef(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const loadingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const onPlayRef = useRef(onPlay)
  const onPauseRef = useRef(onPause)
  const onErrorRef = useRef(onError)
  const mediaSrc = useMemo(() => combinationApiResource(src), [src])
  const progress = duration > 0 && Number.isFinite(duration) ? (currentTime / duration) * 100 : 0

  const clearLoading = () => {
    if (loadingTimeoutRef.current) {
      clearTimeout(loadingTimeoutRef.current)
      loadingTimeoutRef.current = null
    }
    setLoading(false)
  }

  const shouldShowBuffering = (video: HTMLVideoElement) => {
    return !video.ended && !video.paused && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA
  }

  const showVideoError = (message = '视频加载失败') => {
    setError(message)
    setLoading(false)
    onErrorRef.current?.(message)
  }

  // 处理播放/暂停
  const handlePlayPause = () => {
    const video = videoRef.current
    if (!video) return

    if (isPlaying) {
      video.pause()
      return
    }

    video.play().catch(() => {
      showVideoError('视频播放失败')
    })
  }

  useEffect(() => {
    onPlayRef.current = onPlay
    onPauseRef.current = onPause
    onErrorRef.current = onError
  }, [onPlay, onPause, onError])

  useEffect(() => {
    const video = videoRef.current
    hasStartedPlayingRef.current = false
    setIsPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setError(null)
    setLoading(true)

    if (video) {
      video.load()
    }
  }, [mediaSrc])

  // 视频事件处理
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleLoadedMetadata = () => {
      setDuration(video.duration)
    }

    const handleCanRenderFrame = () => {
      clearLoading()
    }

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA || video.ended) {
        clearLoading()
      }
    }

    const handlePlay = () => {
      setIsPlaying(true)
      hasStartedPlayingRef.current = true
      onPlayRef.current?.()
    }

    const handlePause = () => {
      setIsPlaying(false)
      onPauseRef.current?.()
      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA || video.ended) {
        clearLoading()
      }
    }

    const handleError = () => {
      showVideoError()
    }

    const handleLoadStart = () => {
      setLoading(true)
    }

    const handleCanPlay = () => {
      clearLoading()
      hasStartedPlayingRef.current = true
    }

    const handleWaiting = () => {
      if (hasStartedPlayingRef.current && shouldShowBuffering(video)) {
        setLoading(true)
      }
    }

    const handlePlaying = () => {
      clearLoading()
      hasStartedPlayingRef.current = true
    }

    const handleEnded = () => {
      clearLoading()
      setIsPlaying(false)
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('loadeddata', handleCanRenderFrame)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('error', handleError)
    video.addEventListener('loadstart', handleLoadStart)
    video.addEventListener('canplay', handleCanPlay)
    video.addEventListener('canplaythrough', handleCanRenderFrame)
    video.addEventListener('waiting', handleWaiting)
    video.addEventListener('playing', handlePlaying)
    video.addEventListener('ended', handleEnded)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('loadeddata', handleCanRenderFrame)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('error', handleError)
      video.removeEventListener('loadstart', handleLoadStart)
      video.removeEventListener('canplay', handleCanPlay)
      video.removeEventListener('canplaythrough', handleCanRenderFrame)
      video.removeEventListener('waiting', handleWaiting)
      video.removeEventListener('playing', handlePlaying)
      video.removeEventListener('ended', handleEnded)
    }
  }, [])

  useEffect(() => {
    const video = videoRef.current
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
    <div className={cn('video-player relative bg-black', className)}>
      <video
        ref={videoRef}
        className="w-full h-auto"
        autoPlay={autoPlay}
        muted
        loop={loop}
        preload={preload}
        playsInline
        controls={false}
        onClick={handlePlayPause}
      >
        <source src={mediaSrc} />
        您的浏览器不支持视频播放。
      </video>

      {/* 加载指示器 */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="bg-white/90 rounded-full p-4">
            <Loader2Icon className="w-8 h-8 text-neutral-600 animate-spin" />
          </div>
        </div>
      )}

      {/* 播放/暂停按钮覆盖层 */}
      {!loading && !isPlaying && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            type="button"
            aria-label="播放视频"
            onClick={handlePlayPause}
            className="bg-white/60 hover:bg-white/80 rounded-full p-4 transition-all duration-300 shadow-lg"
          >
            <PlayIcon className="w-12 h-12 text-neutral-600 fill-current" />
          </button>
        </div>
      )}

      {/* 底部进度条 */}
      {!loading && (
        <div className="absolute bottom-0 left-0 right-0 h-1 sm:h-1.5 bg-white/30">
          <div
            className="h-full bg-blue-500 transition-all duration-150 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
    </div>
  )
}

export default VideoPlayer
