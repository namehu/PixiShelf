'use client'

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
  const [ref, inView] = useInView({
    threshold: 0.1,
    triggerOnce: true
  })

  const handleVideoLoad = () => {
    setLoaded(true)
  }

  const handleVideoError = () => {
    setError(true)
  }

  const handleThumbnailLoad = () => {
    setThumbnailLoaded(true)
  }

  const handleThumbnailError = () => {
    setThumbnailLoaded(false)
  }

  // Generate thumbnail URL from video URL
  const getThumbnailUrl = (videoUrl: string) => {
    // For local videos, we'll try to generate a thumbnail
    // This is a simplified approach - in production you might want to generate actual thumbnails
    return videoUrl.replace(/\.(mp4|webm|ogg)$/i, '_thumb.jpg')
  }

  return (
    <div ref={ref} className={`relative overflow-hidden bg-gray-900 ${className}`}>
      {inView && (
        <>
          {/* Thumbnail */}
          {!loaded && !error && (
            <img
              src={getThumbnailUrl(src)}
              alt={title}
              className="w-full h-full object-cover"
              onLoad={handleThumbnailLoad}
              onError={handleThumbnailError}
            />
          )}

          {/* Video */}
          <video
            ref={videoRef}
            src={src}
            className={`w-full h-full object-cover transition-opacity duration-300 ${
              loaded ? 'opacity-100' : 'opacity-0'
            }`}
            onLoadedData={handleVideoLoad}
            onError={handleVideoError}
            muted
            loop
            playsInline
            preload="metadata"
          />

          {/* Play Icon Overlay */}
          {showPlayIcon && !loaded && (
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="bg-black bg-opacity-50 rounded-full p-4">
                <svg
                  className="w-8 h-8 text-white"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
          )}

          {/* Video Label */}
          {showVideoLabel && (
            <div className="absolute top-2 left-2">
              <span className="bg-black bg-opacity-70 text-white text-xs px-2 py-1 rounded">
                VIDEO
              </span>
            </div>
          )}

          {/* Error State */}
          {error && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
              <div className="text-center text-white">
                <svg
                  className="w-12 h-12 mx-auto mb-2 opacity-50"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <p className="text-sm opacity-70">Failed to load video</p>
              </div>
            </div>
          )}

          {/* Loading State */}
          {!loaded && !error && !thumbnailLoaded && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default VideoPreview