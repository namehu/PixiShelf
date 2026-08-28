'use client'

import { InfoIcon, Loader2Icon, PauseIcon, PlayIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cn } from '@/lib/utils'
import { withMediaVersion } from '@/lib/media-url'
import { combinationApiResource } from '@/utils/combination-static'

interface AnimatedWebpPlayerProps {
  src: string
  alt?: string
  size?: number | null
  isAnimated?: boolean
  formatLabel?: string
  className?: string
  updatedAt?: string | null
  fillContainer?: boolean
  posterLoading?: 'eager' | 'lazy'
  onPosterLoad?: () => void
  onPosterError?: () => void
}

const IMGPROXY_URL = process.env.NEXT_PUBLIC_IMGPROXY_URL || 'http://localhost:5431'

function getStaticWebpPosterUrl(src: string, width = 1200) {
  const normalizedSrc = src.startsWith('/') ? src : `/${src}`
  return `${IMGPROXY_URL}/_/rs:fit:${width}:0/q:90/sm:1/plain/local://${encodeURIComponent(`/media${normalizedSrc}`)}@jpg`
}

function formatFileSize(size?: number | null) {
  if (!size || size <= 0) return null

  const mb = size / 1024 / 1024
  if (mb >= 1) return `${mb.toFixed(mb >= 10 ? 0 : 1)}MB`

  const kb = size / 1024
  return `${Math.max(kb, 1).toFixed(0)}KB`
}

export default function AnimatedWebpPlayer({
  src,
  alt = src,
  size,
  isAnimated = true,
  formatLabel = 'WEBP',
  className,
  updatedAt,
  fillContainer = false,
  posterLoading = 'lazy',
  onPosterLoad,
  onPosterError
}: AnimatedWebpPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoadingAnimation, setIsLoadingAnimation] = useState(false)
  const [animationFailed, setAnimationFailed] = useState(false)
  const containerRef = useRef<HTMLButtonElement>(null)
  const originalSrc = useMemo(() => withMediaVersion(combinationApiResource(src), updatedAt), [src, updatedAt])
  const posterSrc = useMemo(() => withMediaVersion(getStaticWebpPosterUrl(src), updatedAt), [src, updatedAt])
  const fileSize = formatFileSize(size)

  const pausePlayback = useCallback(() => {
    setIsPlaying(false)
    setIsLoadingAnimation(false)
  }, [])

  const handleTogglePlayback = () => {
    if (isPlaying) {
      pausePlayback()
      return
    }

    setAnimationFailed(false)
    setIsLoadingAnimation(true)
    setIsPlaying(true)
  }

  useEffect(() => {
    if (isAnimated) return
    pausePlayback()
  }, [isAnimated, pausePlayback])

  useEffect(() => {
    if (!isPlaying || typeof IntersectionObserver === 'undefined') return

    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) pausePlayback()
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [isPlaying, pausePlayback])

  useEffect(() => {
    if (!isPlaying) return

    const handleVisibilityChange = () => {
      if (document.hidden) pausePlayback()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isPlaying, pausePlayback])

  const handleAnimationLoad = () => {
    setIsLoadingAnimation(false)
  }

  const handleAnimationError = () => {
    setIsLoadingAnimation(false)
    setAnimationFailed(true)
    setIsPlaying(false)
  }

  const content = (
    <>
      <img
        src={posterSrc}
        alt={alt}
        loading={posterLoading}
        decoding="async"
        className={cn('block w-full object-contain', fillContainer ? 'h-full' : 'h-auto')}
        onLoad={onPosterLoad}
        onError={onPosterError}
      />

      {isAnimated && isPlaying && !animationFailed && (
        <img
          src={originalSrc}
          alt={alt}
          loading="eager"
          decoding="async"
          className="absolute inset-0 h-full w-full object-contain"
          onLoad={handleAnimationLoad}
          onError={handleAnimationError}
        />
      )}

      <div className="absolute right-2 top-2 flex h-5 items-center gap-1 rounded-sm bg-[#ff2f4d] px-2 text-[10px] font-semibold leading-none tabular-nums text-white shadow-sm">
        {isAnimated &&
          (isPlaying ? <PauseIcon className="size-3 fill-current" /> : <PlayIcon className="size-3 fill-current" />)}
        <span>{formatLabel}</span>
        {!isPlaying && fileSize && <span>{fileSize}</span>}
      </div>

      {isAnimated && isLoadingAnimation && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/20">
          <div className="rounded-full bg-white/90 p-3">
            <Loader2Icon className="h-7 w-7 animate-spin text-neutral-700" />
          </div>
        </div>
      )}

      {isAnimated && animationFailed && (
        <div className="absolute inset-x-3 bottom-3 flex items-center gap-2 rounded bg-black/55 px-3 py-2 text-xs text-white">
          <InfoIcon className="h-4 w-4 shrink-0" />
          <span>动图加载失败，已保留静态预览</span>
        </div>
      )}
    </>
  )

  const containerClassName = cn(
    'relative w-full bg-neutral-100',
    fillContainer && 'h-full',
    isAnimated && 'cursor-pointer',
    className
  )

  if (!isAnimated) {
    return <div className={containerClassName}>{content}</div>
  }

  return (
    <button
      ref={containerRef}
      type="button"
      className={cn(containerClassName, 'block border-0 p-0 text-left')}
      aria-label={`${isPlaying ? '暂停' : '播放'} ${formatLabel} 动图`}
      aria-pressed={isPlaying}
      aria-busy={isLoadingAnimation}
      onClick={handleTogglePlayback}
    >
      {content}
    </button>
  )
}
