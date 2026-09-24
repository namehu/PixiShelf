'use client'

import { InfoIcon, PauseIcon, PlayIcon, SquareIcon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { cn } from '@/lib/utils'
import { withMediaVersion } from '@/lib/media-url'
import { combinationApiResource } from '@/utils/combination-static'
import { createSingleLoopWebp } from '@/lib/single-loop-webp'
import { isWebpFile } from '@/lib/media'
import type { PlayerFailure, PlayerSnapshot } from '@pixishelf/webp-player'
import type { AnimationMetadataDto } from '@/schemas/artwork.dto'
import { AnimationPlaybackCapsule } from './animation-playback-capsule'
import StreamingWebpSurface from './streaming-webp-surface'

type AnimatedWebpPlayerControlMode = 'surface' | 'badge' | 'external'

interface AnimatedWebpPlayerProps {
  src: string
  alt?: string
  size?: number | null
  animationMetadata?: AnimationMetadataDto | null
  isAnimated?: boolean
  formatLabel?: string
  className?: string
  updatedAt?: string | null
  fillContainer?: boolean
  posterLoading?: 'eager' | 'lazy'
  onPosterLoad?: (image: HTMLImageElement) => void
  onPosterError?: () => void
  onAnimationError?: () => void
  onAnimationReady?: () => void
  onAnimationBuffering?: () => void
  onAnimationComplete?: () => void
  onPlaybackInterrupted?: () => void
  playbackKey?: string | number
  autoBrowseControl?: boolean
  controlMode?: AnimatedWebpPlayerControlMode
  playing?: boolean
  playOnce?: boolean
  playbackPaused?: boolean
  manualPlaybackPaused?: boolean
  onPlayingChange?: (playing: boolean) => void
  onPlaybackProgress?: (percent: number | null) => void
}

const IMGPROXY_URL = process.env.NEXT_PUBLIC_IMGPROXY_URL || 'http://localhost:5431'

const fallbackReason: Record<PlayerFailure['code'], string> = {
  unsupported: '浏览器不支持流式播放',
  initialization: '播放组件加载失败',
  budget: '超出流式播放预算',
  'file-limit': '文件超过流式播放上限',
  'pixel-limit': '图片尺寸超过流式播放上限',
  'memory-limit': '播放内存不足',
  metadata: '包含暂不支持的图片元数据',
  network: '网络错误',
  auth: '无权访问',
  invalid: '图片损坏',
  internal: '播放错误'
}

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
  animationMetadata,
  isAnimated = true,
  formatLabel = 'WEBP',
  className,
  updatedAt,
  fillContainer = false,
  posterLoading = 'lazy',
  onPosterLoad,
  onPosterError,
  onAnimationError,
  onAnimationReady,
  onAnimationBuffering,
  onAnimationComplete,
  onPlaybackInterrupted,
  playbackKey,
  autoBrowseControl = false,
  controlMode = 'surface',
  playing,
  playOnce = false,
  playbackPaused = false,
  manualPlaybackPaused = false,
  onPlayingChange,
  onPlaybackProgress
}: AnimatedWebpPlayerProps) {
  const [uncontrolledPlaying, setUncontrolledPlaying] = useState(false)
  const [manualPausedAttempt, setManualPausedAttempt] = useState<string | null>(null)
  const [streamProgress, setStreamProgress] = useState<{ attempt: string; snapshot: PlayerSnapshot } | null>(null)
  const [isLoadingAnimation, setIsLoadingAnimation] = useState(false)
  const [animationFailed, setAnimationFailed] = useState(false)
  const [fallbackAttempt, setFallbackAttempt] = useState<string | null>(null)
  const [fallbackNotice, setFallbackNotice] = useState<{ attempt: string; code: PlayerFailure['code'] } | null>(null)
  const [fallbackCode, setFallbackCode] = useState<PlayerFailure['code'] | null>(null)
  const fallbackSeen = useRef<string | null>(null)
  const [streamReadyAttempt, setStreamReadyAttempt] = useState<string | null>(null)
  const [singleLoop, setSingleLoop] = useState<{
    source: string
    url: string
    durationMs: number
    key?: string | number
  } | null>(null)
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null)
  const containerRef = useRef<HTMLElement | null>(null)
  const callbacks = useRef({
    onAnimationError,
    onAnimationReady,
    onAnimationBuffering,
    onAnimationComplete,
    onPlaybackInterrupted,
    onPlayingChange,
    onPlaybackProgress
  })
  // 保存最新回调，避免仅回调引用变化就重启请求或计时。
  callbacks.current = {
    onAnimationError,
    onAnimationReady,
    onAnimationBuffering,
    onAnimationComplete,
    onPlaybackInterrupted,
    onPlayingChange,
    onPlaybackProgress
  }
  const originalSrc = useMemo(() => withMediaVersion(combinationApiResource(src), updatedAt), [src, updatedAt])
  const posterSrc = useMemo(() => withMediaVersion(getStaticWebpPosterUrl(src), updatedAt), [src, updatedAt])
  const fileSize = formatFileSize(size)
  const requestedPlaying = playing ?? uncontrolledPlaying
  const isPlaying = isAnimated && requestedPlaying
  const attemptSource = `${originalSrc}:${playbackKey}`
  const attemptIdentity = useRef({ source: attemptSource, sequence: 0 })
  if (attemptIdentity.current.source !== attemptSource) {
    attemptIdentity.current = { source: attemptSource, sequence: attemptIdentity.current.sequence + 1 }
  }
  const attempt = `${attemptIdentity.current.sequence}:${attemptSource}`
  const manualPaused = manualPausedAttempt === attempt || manualPlaybackPaused
  // Policy v1 applies the same <=10ms -> 100ms frame normalization as the WASM player.
  const durationMs =
    animationMetadata?.format === 'WEBP' &&
    animationMetadata.timingPolicyVersion === 1 &&
    Number.isSafeInteger(animationMetadata.durationMs) &&
    animationMetadata.durationMs > 0
      ? animationMetadata.durationMs
      : null
  const progressSnapshot = streamProgress?.attempt === attempt ? streamProgress.snapshot : null
  const progressPercent =
    durationMs !== null &&
    progressSnapshot &&
    isAnimated &&
    (isPlaying || playbackPaused || manualPaused) &&
    isWebpFile(src.split(/[?#]/)[0]) &&
    fallbackAttempt !== attempt
      ? progressSnapshot.status === 'ended'
        ? 100
        : Math.min(100, Math.max(0, Math.floor((progressSnapshot.positionMs / durationMs) * 100)))
      : null
  const controlLabel = `${isPlaying && playOnce ? '停止本轮动图' : `${isPlaying ? '暂停' : '播放'} ${formatLabel} 动图`}${progressPercent === null ? '' : `，${progressPercent}%`}`
  useEffect(() => {
    setFallbackNotice((notice) => (notice?.attempt === attempt ? notice : null))
  }, [attempt])
  useEffect(() => {
    callbacks.current.onPlaybackProgress?.(null)
  }, [attempt, durationMs, fallbackAttempt])
  useEffect(() => {
    if (fallbackNotice?.attempt !== attempt) return
    const timer = window.setTimeout(() => setFallbackNotice(null), 4000)
    return () => window.clearTimeout(timer)
  }, [fallbackNotice, attempt])
  const streaming =
    isWebpFile(src.split(/[?#]/)[0]) &&
    isAnimated &&
    (isPlaying || playbackPaused || manualPaused) &&
    fallbackAttempt !== attempt
  const animationSrc = playOnce
    ? singleLoop?.source === originalSrc && singleLoop.key === playbackKey
      ? singleLoop.url
      : null
    : originalSrc
  const currentPlayback = useRef({ animationSrc, playbackKey, isPlaying })
  // 媒体事件可能晚到；用来源、播放键和播放状态隔离过期事件。
  currentPlayback.current = { animationSrc, playbackKey, isPlaying }
  const loadingAnimation =
    isPlaying &&
    (streaming
      ? streamReadyAttempt !== attempt
      : playOnce
        ? !animationSrc || loadedUrl !== animationSrc
        : isLoadingAnimation)

  const setContainerNode = useCallback((node: HTMLElement | null) => {
    containerRef.current = node
  }, [])

  const setPlayback = useCallback(
    (nextPlaying: boolean) => {
      if (playing === undefined) setUncontrolledPlaying(nextPlaying)
      callbacks.current.onPlayingChange?.(nextPlaying)
    },
    [playing]
  )

  const pausePlayback = useCallback(() => {
    setManualPausedAttempt(null)
    setStreamProgress(null)
    callbacks.current.onPlaybackProgress?.(null)
    if (requestedPlaying) setPlayback(false)
    setIsLoadingAnimation(false)
  }, [requestedPlaying, setPlayback])

  const handleTogglePlayback = useCallback(() => {
    if (isPlaying) {
      if (streaming && !playOnce) {
        setManualPausedAttempt(attempt)
        setPlayback(false)
        setIsLoadingAnimation(false)
      } else pausePlayback()
      return
    }

    if (!manualPaused) setStreamProgress(null)
    setManualPausedAttempt(null)
    setAnimationFailed(false)
    setIsLoadingAnimation(true)
    setPlayback(true)
  }, [isPlaying, manualPaused, pausePlayback, setPlayback, streaming, playOnce, attempt])

  const stopControlEvent = useCallback((event: SyntheticEvent) => {
    event.stopPropagation()
  }, [])

  useEffect(() => {
    if (isAnimated) return
    pausePlayback()
  }, [isAnimated, pausePlayback])

  useEffect(() => {
    if (!isPlaying) {
      setIsLoadingAnimation(false)
      return
    }

    setAnimationFailed(false)
    setIsLoadingAnimation(true)
  }, [isPlaying, src])

  useEffect(() => {
    if (!isPlaying || !playOnce || streaming) return
    const controller = new AbortController()
    let cancelled = false
    let url: string | null = null
    void (async () => {
      try {
        const response = await fetch(originalSrc, { signal: controller.signal })
        if (!response.ok) throw new Error('动图加载失败')
        const buffer = await response.arrayBuffer()
        if (cancelled) return
        const result = createSingleLoopWebp(buffer)
        url = URL.createObjectURL(result.blob)
        setSingleLoop({ source: originalSrc, url, durationMs: result.durationMs, key: playbackKey })
      } catch {
        if (cancelled) return
        setAnimationFailed(true)
        setIsLoadingAnimation(false)
        callbacks.current.onAnimationError?.()
        setPlayback(false)
      }
    })()
    return () => {
      // 停播或切换尝试时中止读取，并释放本次尝试创建的 Blob URL。
      cancelled = true
      controller.abort()
      if (url) URL.revokeObjectURL(url)
      setSingleLoop(null)
      setLoadedUrl(null)
    }
  }, [isPlaying, playOnce, originalSrc, playbackKey, setPlayback, streaming])

  useEffect(() => {
    if (!isPlaying || !playOnce || !singleLoop || loadedUrl !== animationSrc || !animationSrc) return
    // 图片加载成功后，才按单次循环的总帧时长启动完成计时。
    const complete = callbacks.current.onAnimationComplete
    callbacks.current.onAnimationReady?.()
    const timer = window.setTimeout(() => complete?.(), singleLoop.durationMs)
    return () => window.clearTimeout(timer)
  }, [isPlaying, playOnce, singleLoop, loadedUrl, animationSrc, playbackKey])

  useEffect(() => {
    if ((!isPlaying && !playbackPaused && !manualPaused) || typeof IntersectionObserver === 'undefined') return

    const container = containerRef.current
    if (!container) return

    const observer = new IntersectionObserver(([entry]) => {
      if (entry && !entry.isIntersecting) {
        if (callbacks.current.onPlaybackInterrupted) callbacks.current.onPlaybackInterrupted()
        else pausePlayback()
      }
    })
    observer.observe(container)

    return () => observer.disconnect()
  }, [isPlaying, playbackPaused, manualPaused, pausePlayback])

  useEffect(() => {
    if (!isPlaying && !manualPaused) return

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (callbacks.current.onPlaybackInterrupted) callbacks.current.onPlaybackInterrupted()
        else pausePlayback()
      }
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [isPlaying, manualPaused, pausePlayback])

  const handleAnimationLoad = () => {
    if (
      !currentPlayback.current.isPlaying ||
      currentPlayback.current.animationSrc !== animationSrc ||
      currentPlayback.current.playbackKey !== playbackKey
    ) {
      return
    }
    setIsLoadingAnimation(false)
    setLoadedUrl(animationSrc)
  }

  const handleAnimationError = () => {
    if (
      !currentPlayback.current.isPlaying ||
      currentPlayback.current.animationSrc !== animationSrc ||
      currentPlayback.current.playbackKey !== playbackKey
    ) {
      return
    }
    setIsLoadingAnimation(false)
    setAnimationFailed(true)
    callbacks.current.onAnimationError?.()
    setPlayback(false)
  }

  const badgeContent = (
    <>
      {isAnimated &&
        (isPlaying ? (
          playOnce ? (
            <SquareIcon className="size-3 fill-current" />
          ) : (
            <PauseIcon className="size-3 fill-current" />
          )
        ) : (
          <PlayIcon className="size-3 fill-current" />
        ))}
      <span>{formatLabel}</span>
      {!isPlaying && fileSize && <span>{fileSize}</span>}
    </>
  )

  const badgeClassName =
    'absolute right-2 z-10 flex items-center gap-1 rounded-sm bg-[#ff2f4d] px-2 text-[10px] font-semibold leading-none tabular-nums text-white shadow-sm'

  const webpControl = isWebpFile(src.split(/[?#]/)[0])
  const capsule = (
    <AnimationPlaybackCapsule
      playing={isPlaying}
      playOnce={playOnce}
      label={formatLabel}
      fileSize={fileSize}
      progressPercent={progressPercent}
    />
  )
  const playbackBadge =
    controlMode === 'external' ? null : controlMode === 'badge' && isAnimated ? (
      <button
        type="button"
        className="absolute bottom-0 right-2 z-10 flex min-h-11 min-w-11 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent p-0 focus-visible:outline-2 focus-visible:outline-ring"
        data-long-press-ignore
        data-auto-browse-controls={autoBrowseControl || playOnce || undefined}
        aria-label={controlLabel}
        aria-pressed={isPlaying}
        aria-busy={loadingAnimation}
        onClick={(event) => {
          stopControlEvent(event)
          handleTogglePlayback()
        }}
        onMouseDown={stopControlEvent}
        onMouseUp={stopControlEvent}
        onPointerDown={stopControlEvent}
        onPointerUp={stopControlEvent}
        onTouchStart={stopControlEvent}
        onTouchEnd={stopControlEvent}
      >
        {webpControl ? capsule : (
          <span className="flex h-[22px] items-center justify-center gap-1 rounded-full bg-[#ff2f4d] px-2 text-xs font-semibold leading-none tabular-nums text-white shadow-sm">
            {badgeContent}
          </span>
        )}
      </button>
    ) : webpControl && isAnimated && controlMode === 'surface' ? (
      <span className="pointer-events-none absolute bottom-0 right-2 z-10 flex min-h-11 min-w-11 items-center justify-center">
        {capsule}
      </span>
    ) : (
      <div className={cn(badgeClassName, 'top-2 h-5')}>{badgeContent}</div>
    )

  const content = (
    <>
      <img
        src={posterSrc}
        alt={alt}
        loading={posterLoading}
        decoding="async"
        draggable={false}
        className={cn('block w-full object-contain', fillContainer ? 'h-full' : 'h-auto')}
        onLoad={(event) => onPosterLoad?.(event.currentTarget)}
        onError={onPosterError}
      />

      {streaming && (
        <StreamingWebpSurface
          src={originalSrc}
          alt={alt}
          size={size}
          durationMs={durationMs}
          playbackKey={playbackKey}
          paused={playbackPaused || !isPlaying}
          loop={!playOnce}
          onProgress={(snapshot) => {
            if (`${attemptIdentity.current.sequence}:${attemptIdentity.current.source}` !== attempt) return
            setStreamProgress({ attempt, snapshot })
            const percent =
              durationMs === null
                ? null
                : snapshot.status === 'ended'
                  ? 100
                  : Math.min(100, Math.max(0, Math.floor((snapshot.positionMs / durationMs) * 100)))
            callbacks.current.onPlaybackProgress?.(percent)
          }}
          onReady={() => {
            setStreamReadyAttempt(attempt)
            callbacks.current.onAnimationReady?.()
          }}
          onBuffering={() => callbacks.current.onAnimationBuffering?.()}
          onComplete={() => {
            if (playOnce) callbacks.current.onAnimationComplete?.()
            else {
              setManualPausedAttempt(attempt)
              setPlayback(false)
            }
          }}
          onFallback={(failure) => {
            if (fallbackSeen.current === attempt) return
            fallbackSeen.current = attempt
            setFallbackAttempt(attempt)
            setFallbackCode(failure.code)
            setFallbackNotice({ attempt, code: failure.code })
          }}
          onError={() => {
            setAnimationFailed(true)
            callbacks.current.onAnimationError?.()
            setPlayback(false)
          }}
        />
      )}

      {!streaming && isAnimated && isPlaying && !animationFailed && animationSrc && (
        <img
          key={animationSrc}
          src={animationSrc}
          alt={alt}
          loading="eager"
          decoding="async"
          draggable={false}
          className="absolute inset-0 h-full w-full object-contain"
          onLoad={handleAnimationLoad}
          onError={handleAnimationError}
        />
      )}

      {playbackBadge}

      {fallbackNotice?.attempt === attempt && !animationFailed && (
        <div
          role="status"
          className="pointer-events-none absolute inset-x-3 top-3 z-20 rounded bg-black/65 px-3 py-1.5 text-xs text-white"
        >
          兼容播放：{fallbackReason[fallbackNotice.code]}。完整加载后开始，暂停后重播
        </div>
      )}

      {isAnimated && animationFailed && (
        <div className="pointer-events-none absolute inset-x-3 bottom-3 flex items-center gap-2 rounded bg-black/55 px-3 py-2 text-xs text-white">
          <InfoIcon className="h-4 w-4 shrink-0" />
          <span>动图加载失败，已保留静态预览</span>
        </div>
      )}
    </>
  )

  const containerClassName = cn(
    'relative w-full bg-neutral-100',
    fillContainer && 'h-full',
    isAnimated && controlMode === 'surface' && 'cursor-pointer',
    className
  )

  if (!isAnimated || controlMode !== 'surface') {
    return (
      <div
        ref={setContainerNode}
        className={containerClassName}
        aria-busy={loadingAnimation || undefined}
        data-animation-status={
          isPlaying ? (animationFailed ? 'error' : loadingAnimation ? 'loading' : 'ready') : 'idle'
        }
        data-animation-duration-ms={playOnce ? singleLoop?.durationMs : undefined}
        data-webp-fallback-reason={fallbackAttempt === attempt ? fallbackCode : undefined}
      >
        {content}
      </div>
    )
  }

  return (
    <button
      ref={setContainerNode}
      type="button"
      className={cn(containerClassName, 'block border-0 p-0 text-left')}
      aria-label={controlLabel}
      aria-pressed={isPlaying}
      aria-busy={loadingAnimation}
      data-webp-fallback-reason={fallbackAttempt === attempt ? fallbackCode : undefined}
      onClick={handleTogglePlayback}
    >
      {content}
    </button>
  )
}
