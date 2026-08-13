'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { normalizeVideoKeyframeManifest, type NormalizedVideoKeyframe } from './video-keyframes'

interface UseVideoKeyframesResult {
  keyframes: NormalizedVideoKeyframe[]
  publishedAt: string | null
  loading: boolean
  loaded: boolean
  error: string | null
  reload: () => void
}

export function useVideoKeyframes(keyframesUrl?: string | null): UseVideoKeyframesResult {
  const [keyframes, setKeyframes] = useState<NormalizedVideoKeyframe[]>([])
  const [publishedAt, setPublishedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const previousUrlRef = useRef<string | null>(null)

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1)
  }, [])

  useEffect(() => {
    const requestUrl = keyframesUrl ?? null
    if (!requestUrl) {
      previousUrlRef.current = null
      setKeyframes([])
      setPublishedAt(null)
      setLoading(false)
      setLoaded(true)
      setError(null)
      return
    }
    const resolvedUrl = requestUrl

    if (previousUrlRef.current !== requestUrl) {
      previousUrlRef.current = requestUrl
      setKeyframes([])
      setPublishedAt(null)
      setLoaded(false)
    }

    const controller = new AbortController()

    async function loadKeyframes() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(resolvedUrl, { signal: controller.signal, cache: 'no-store' })
        if (response.status === 404) {
          setKeyframes([])
          setPublishedAt(null)
          return
        }
        if (!response.ok) throw new Error(`画面加载失败 (${response.status})`)

        const normalized = normalizeVideoKeyframeManifest(await response.json())
        setKeyframes(normalized.frames)
        setPublishedAt(normalized.publishedAt)
      } catch (error) {
        if (controller.signal.aborted) return
        setKeyframes([])
        setPublishedAt(null)
        setError(error instanceof Error ? error.message : '画面加载失败')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
          setLoaded(true)
        }
      }
    }

    void loadKeyframes()
    return () => controller.abort()
  }, [keyframesUrl, reloadKey])

  return useMemo(
    () => ({ keyframes, publishedAt, loading, loaded, error, reload }),
    [keyframes, publishedAt, loading, loaded, error, reload]
  )
}
