'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { normalizeVideoChapterManifest, type NormalizedChapter } from './video-chapters'

interface UseVideoChaptersResult {
  chapters: NormalizedChapter[]
  duration: number
  loading: boolean
  error: string | null
  reload: () => void
}

/**
 * 负责加载并标准化视频章节，不影响播放器主体播放。
 */
export function useVideoChapters(chaptersUrl?: string | null): UseVideoChaptersResult {
  const [chapters, setChapters] = useState<NormalizedChapter[]>([])
  const [duration, setDuration] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const reload = useCallback(() => {
    setReloadKey((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!chaptersUrl) {
      setChapters([])
      setDuration(0)
      setLoading(false)
      setError(null)
      return
    }

    const requestUrl = chaptersUrl
    const controller = new AbortController()

    async function loadChapters() {
      setLoading(true)
      setError(null)

      try {
        const response = await fetch(requestUrl, {
          signal: controller.signal
        })

        if (response.status === 404) {
          setChapters([])
          setDuration(0)
          setError(null)
          return
        }

        if (!response.ok) {
          throw new Error(`章节加载失败 (${response.status})`)
        }

        const payload = await response.json()
        const normalized = normalizeVideoChapterManifest(payload)

        setChapters(normalized.chapters)
        setDuration(normalized.duration)
      } catch (error) {
        if (controller.signal.aborted) {
          return
        }

        setChapters([])
        setDuration(0)
        setError(error instanceof Error ? error.message : '章节加载失败')
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false)
        }
      }
    }

    loadChapters()

    return () => {
      controller.abort()
    }
  }, [chaptersUrl, reloadKey])

  return useMemo(
    () => ({
      chapters,
      duration,
      loading,
      error,
      reload
    }),
    [chapters, duration, loading, error, reload]
  )
}
