'use client'

import { InfoIcon, Loader2Icon, PlayIcon } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { combinationApiResource } from '@/utils/combinationStatic'

interface AnimatedWebpPlayerProps {
  src: string
  alt?: string
  size?: number | null
  isAnimated?: boolean
  className?: string
}

const IMGPROXY_URL = process.env.NEXT_PUBLIC_IMGPROXY_URL || 'http://localhost:5431'

function getStaticWebpPosterUrl(src: string, width = 1200) {
  const normalizedSrc = src.startsWith('/') ? src : `/${src}`
  return `${IMGPROXY_URL}/_/rs:fit:${width}:0/q:90/sm:1/plain/local://${encodeURIComponent(normalizedSrc)}@jpg`
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
  className
}: AnimatedWebpPlayerProps) {
  const [isPlaying, setIsPlaying] = useState(false)
  const [isLoadingAnimation, setIsLoadingAnimation] = useState(false)
  const [animationFailed, setAnimationFailed] = useState(false)
  const originalSrc = useMemo(() => combinationApiResource(src), [src])
  const posterSrc = useMemo(() => getStaticWebpPosterUrl(src), [src])
  const fileSize = formatFileSize(size)

  const handlePlay = () => {
    if (!isAnimated) return

    setAnimationFailed(false)
    setIsLoadingAnimation(true)
    setIsPlaying(true)
  }

  const handleAnimationLoad = () => {
    setIsLoadingAnimation(false)
  }

  const handleAnimationError = () => {
    setIsLoadingAnimation(false)
    setAnimationFailed(true)
    setIsPlaying(false)
  }

  return (
    <div className={cn('relative w-full bg-neutral-100', className)}>
      <img src={posterSrc} alt={alt} loading="lazy" decoding="async" className="block w-full h-auto object-contain" />

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
        <span>WEBP</span>
        {!isPlaying && fileSize && <span>{fileSize}</span>}
      </div>

      {isAnimated && !isPlaying && (
        <button
          type="button"
          aria-label="播放 WebP 动图"
          onClick={handlePlay}
          className="absolute inset-0 flex items-center justify-center bg-black/10 transition-colors hover:bg-black/15"
        >
          <span className="rounded-full bg-black/45 p-4 text-white shadow-lg backdrop-blur-sm transition-transform hover:scale-105">
            <PlayIcon className="h-8 w-8 fill-current" />
          </span>
        </button>
      )}

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
    </div>
  )
}
