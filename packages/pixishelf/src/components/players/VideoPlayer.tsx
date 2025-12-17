'use client'

import { InfoIcon } from 'lucide-react'
import React, { useState, useRef, useEffect } from 'react'
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
  const [showPlayButton, setShowPlayButton] = useState(true)
  const videoRef = useRef<HTMLVideoElement>(null)
  const playButtonTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // 处理播放/暂停
  const handlePlayPause = () => {
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause()
      } else {
        videoRef.current.play()
      }
    }
  }

  // 视频事件处理
  useEffect(() => {
    const video = videoRef.current
    if (!video) return

    const handleLoadedMetadata = () => {
      setDuration(video.duration)
      setLoading(false)
    }

    const handleTimeUpdate = () => {
      setCurrentTime(video.currentTime)
    }

    const handlePlay = () => {
      setIsPlaying(true)
      onPlay?.()
    }

    const handlePause = () => {
      setIsPlaying(false)
      onPause?.()
      setShowPlayButton(true)

      // 暂停后1秒隐藏播放按钮
      if (playButtonTimeoutRef.current) {
        clearTimeout(playButtonTimeoutRef.current)
      }
      playButtonTimeoutRef.current = setTimeout(() => {
        setShowPlayButton(false)
      }, 1000)
    }

    const handleError = () => {
      const errorMessage = '视频加载失败'
      setError(errorMessage)
      setLoading(false)
      onError?.(errorMessage)
    }

    const handleLoadStart = () => {
      setLoading(true)
    }

    const handleCanPlay = () => {
      setLoading(false)
    }

    video.addEventListener('loadedmetadata', handleLoadedMetadata)
    video.addEventListener('timeupdate', handleTimeUpdate)
    video.addEventListener('play', handlePlay)
    video.addEventListener('pause', handlePause)
    video.addEventListener('error', handleError)
    video.addEventListener('loadstart', handleLoadStart)
    video.addEventListener('canplay', handleCanPlay)

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata)
      video.removeEventListener('timeupdate', handleTimeUpdate)
      video.removeEventListener('play', handlePlay)
      video.removeEventListener('pause', handlePause)
      video.removeEventListener('error', handleError)
      video.removeEventListener('loadstart', handleLoadStart)
      video.removeEventListener('canplay', handleCanPlay)
    }
  }, [onPlay, onPause, onError])

  // 清理定时器
  useEffect(() => {
    return () => {
      if (playButtonTimeoutRef.current) {
        clearTimeout(playButtonTimeoutRef.current)
      }
    }
  }, [])

  if (error) {
    return (
      <div className={`flex flex-col items-center justify-center bg-neutral-100 text-neutral-600 ${className}`}>
        <InfoIcon className="text-neutral-400 w-16 h-16 mb-4" />
        <p className="text-sm">{error}</p>
        <p className="text-xs text-neutral-500 mt-1">请检查视频文件是否存在或格式是否支持</p>
      </div>
    )
  }

  return (
    <div className={`video-player relative bg-black ${className}`}>
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
        <source src={combinationApiResource(src)} />
        您的浏览器不支持视频播放。
      </video>

      {/* 加载指示器 */}
      {loading && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50">
          <div className="bg-white/90 rounded-full p-4">
            <svg className="w-8 h-8 text-neutral-600 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
          </div>
        </div>
      )}

      {/* 播放/暂停按钮覆盖层 */}
      {!loading && !isPlaying && showPlayButton && (
        <div className="absolute inset-0 flex items-center justify-center">
          <button
            onClick={handlePlayPause}
            className="bg-white/60 hover:bg-white/80 rounded-full p-4 transition-all duration-300 shadow-lg"
          >
            <svg className="w-12 h-12 text-neutral-600" fill="currentColor" viewBox="0 0 24 24">
              <path d="M8 5v14l11-7z" />
            </svg>
          </button>
        </div>
      )}

      {/* 底部进度条 */}
      {!loading && (
        <div className="absolute bottom-0 left-0 right-0 h-1 sm:h-1.5 bg-white/30">
          <div
            className="h-full bg-blue-500 transition-all duration-150 ease-out"
            style={{ width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%` }}
          />
        </div>
      )}

      {/* 自定义滑块样式通过CSS类实现 */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
          .video-player .slider::-webkit-slider-thumb {
            appearance: none;
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: white;
            cursor: pointer;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          }
          .video-player .slider::-moz-range-thumb {
            width: 16px;
            height: 16px;
            border-radius: 50%;
            background: white;
            cursor: pointer;
            border: none;
            box-shadow: 0 2px 4px rgba(0, 0, 0, 0.2);
          }
        `
        }}
      />
    </div>
  )
}

export default VideoPlayer
