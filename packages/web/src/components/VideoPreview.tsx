import React, { useState, useRef, useEffect } from 'react'
import { useInView } from 'react-intersection-observer'

interface VideoPreviewProps {
  src: string
  title: string
  className?: string
  showPlayIcon?: boolean
  showVideoLabel?: boolean
}

export function VideoPreview({
  src,
  title,
  className = '',
  showPlayIcon = true,
  showVideoLabel = true
}: VideoPreviewProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [thumbnailLoaded, setThumbnailLoaded] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)

  const { ref, inView } = useInView({
    threshold: 0.1,
    rootMargin: '200px 0px',
    triggerOnce: true
  })

  useEffect(() => {
    if (inView && videoRef.current && !loaded) {
      const video = videoRef.current

      const handleLoadedMetadata = () => {
        setLoaded(true)
        setThumbnailLoaded(true)
        // 设置视频到第1秒作为缩略图
        video.currentTime = 1
      }

      const handleError = () => {
        setError(true)
        setLoaded(true)
      }

      const handleSeeked = () => {
        setThumbnailLoaded(true)
      }

      video.addEventListener('loadedmetadata', handleLoadedMetadata)
      video.addEventListener('error', handleError)
      video.addEventListener('seeked', handleSeeked)

      // 开始加载视频
      video.load()

      return () => {
        video.removeEventListener('loadedmetadata', handleLoadedMetadata)
        video.removeEventListener('error', handleError)
        video.removeEventListener('seeked', handleSeeked)
      }
    }
  }, [inView, loaded])

  return (
    <div ref={ref} className={`relative overflow-hidden bg-neutral-100 flex items-center justify-center ${className}`}>
      {inView ? (
        <>
          {error ? (
            // 错误状态
            <div className="w-full h-full flex flex-col items-center justify-center bg-neutral-200 text-neutral-500">
              <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                />
              </svg>
              <span className="text-sm">视频加载失败</span>
            </div>
          ) : (
            <>
              <video
                ref={videoRef}
                className={`w-full h-full object-cover transition-opacity duration-300 ${
                  thumbnailLoaded ? 'opacity-100' : 'opacity-0'
                }`}
                preload="metadata"
                muted
                playsInline
                poster="" // 不使用poster，使用视频第一帧
              >
                <source src={src} />
              </video>

              {/* 加载状态 */}
              {!thumbnailLoaded && (
                <div className="absolute inset-0 bg-neutral-200 animate-pulse flex items-center justify-center">
                  <svg className="w-8 h-8 text-neutral-400 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path
                      className="opacity-75"
                      fill="currentColor"
                      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    />
                  </svg>
                </div>
              )}

              {/* 播放图标覆盖层 */}
              {showPlayIcon && thumbnailLoaded && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20 hover:bg-black/30 transition-colors">
                  <div className="bg-white/90 rounded-full p-3 shadow-lg hover:bg-white transition-colors">
                    <svg className="w-8 h-8 text-neutral-800" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M8 5v14l11-7z" />
                    </svg>
                  </div>
                </div>
              )}
            </>
          )}
        </>
      ) : (
        // 未进入视口时的占位符
        <div className="w-full h-full bg-neutral-200 animate-pulse flex items-center justify-center">
          <svg className="w-12 h-12 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
            />
          </svg>
        </div>
      )}
    </div>
  )
}

export default VideoPreview
