'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { VideoPlaybackSourceDto } from '@/schemas/video-playback.dto'

type Snapshot = { time: number; playing: boolean; volume: number; muted: boolean; rate: number }
export function useVideoPlaybackSource(imageId: number | undefined, originalUrl: string, enabled = true, retryKey = 0) {
  const [resolved, setResolved] = useState<{ id: number; retryKey: number; original: string; playback: string | null } | null>(null)
  const [choice, setChoice] = useState<'playback' | 'original'>('playback')
  const [error, setError] = useState<string | null>(null)
  const pending = useRef<Snapshot | null>(null)
  const retainPause = useRef(false)
  const fallbackAttempted = useRef(false)
  const sequence = useRef(0)
  const current = resolved && resolved.id === imageId && resolved.retryKey === retryKey ? resolved : null
  const src = imageId
    ? current
      ? choice === 'playback'
        ? (current.playback ?? current.original)
        : current.original
      : undefined
    : originalUrl
  const usingPlayback = Boolean(current?.playback && choice === 'playback')

  const resolve = useCallback(
    async (signal?: AbortSignal, preferOriginal = false) => {
      if (!imageId) return
      const request = ++sequence.current
      try {
        const response = await fetch(`/api/v1/media/${imageId}/playback/source`, {
          credentials: 'same-origin',
          cache: 'no-store',
          signal
        })
        if (!response.ok) throw new Error(response.status === 401 ? '请先登录' : '无法读取视频播放源')
        const data = VideoPlaybackSourceDto.parse(await response.json())
        if (request !== sequence.current || signal?.aborted) return
        if (data.status !== 'READY') {
          setResolved(null)
          setError(data.status === 'WRITING' ? '原视频正在修改，请稍后重试' : '原视频不存在或不可读取')
          return
        }
        if (preferOriginal) setChoice('original')
        setResolved({ id: imageId, retryKey, original: data.originalUrl, playback: data.playbackUrl })
        setError(null)
      } catch (error) {
        if (request !== sequence.current || signal?.aborted) return
        setError(error instanceof Error && error.message === '请先登录' ? error.message : '无法读取视频播放源，请重试')
      }
    },
    [imageId, retryKey]
  )

  useEffect(() => {
    setResolved(null)
    setError(null)
    setChoice('playback')
    pending.current = null
    retainPause.current = false
    fallbackAttempted.current = false
    if (!enabled || !imageId) return
    const controller = new AbortController()
    void resolve(controller.signal)
    return () => {
      controller.abort()
      sequence.current++
    }
  }, [imageId, originalUrl, enabled, retryKey, resolve])

  const remember = (video: HTMLVideoElement | null, playing?: boolean) => {
    if (video) retainPause.current = !(playing ?? !video.paused)
    if (video) {
      pending.current = {
        time: Number.isFinite(video.currentTime) ? video.currentTime : 0,
        playing: playing ?? !video.paused,
        volume: video.volume,
        muted: video.muted,
        rate: video.playbackRate
      }
    }
  }
  const switchSource = (video: HTMLVideoElement | null) => {
    remember(video)
    fallbackAttempted.current = false
    setChoice(usingPlayback ? 'original' : 'playback')
  }
  const handleError = (video: HTMLVideoElement | null, playing?: boolean) => {
    if (!imageId || !usingPlayback) return false
    // Artplayer can emit both error and video:error for the same failing load.
    if (fallbackAttempted.current) return true
    fallbackAttempted.current = true
    remember(video, playing)
    void resolve(undefined, true)
    return true
  }
  const restore = (video: HTMLVideoElement, mayPlay = true) => {
    const saved = pending.current
    if (!saved) return false
    pending.current = null
    video.currentTime = Math.min(
      saved.time,
      Number.isFinite(video.duration) ? Math.max(0, video.duration - 0.01) : saved.time
    )
    video.volume = saved.volume
    video.muted = saved.muted
    video.playbackRate = saved.rate
    if (saved.playing && mayPlay) void video.play().catch(() => undefined)
    else video.pause()
    return true
  }
  return {
    src,
    switching: pending.current !== null,
    allowAutoplay: !retainPause.current,
    usingPlayback,
    hasPlayback: Boolean(current?.playback),
    loading: Boolean(imageId && enabled && !current && !error),
    error,
    switchSource,
    handleError,
    restore
  }
}
