'use client'

import { useEffect, useRef, useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { useTRPC } from '@/lib/trpc'

export interface PreviewImageState {
  status: 'loading' | 'loaded' | 'failed'
  url?: string
  width?: number
  height?: number
}

/** One queue shared by the list and fullscreen reader. Visible images precede the single lookahead. */
export function useSourcePreviewImages(previewId: string, generation: number, ordinals: number[], enabled: boolean) {
  const trpc = useTRPC()
  const mutation = useMutation(trpc.archivePreview.image.mutationOptions())
  const [images, setImages] = useState<Map<number, PreviewImageState>>(() => new Map())
  const [revision, setRevision] = useState(0)
  const states = useRef(new Map<number, PreviewImageState>())
  const refresh = useRef(new Set<number>())
  const busy = useRef(false)
  const epoch = useRef(0)
  const cancel = useRef<(() => void) | null>(null)
  const demand = useRef(ordinals)
  demand.current = ordinals

  useEffect(() => {
    epoch.current += 1
    cancel.current?.()
    busy.current = false
    states.current = new Map()
    refresh.current.clear()
    setImages(new Map())
    return () => {
      epoch.current += 1
      cancel.current?.()
    }
  }, [previewId, generation])

  useEffect(() => {
    if (!enabled || busy.current) return
    const ordinal = demand.current.find((value) => !states.current.has(value))
    if (ordinal === undefined) return
    const currentEpoch = epoch.current
    busy.current = true
    states.current.set(ordinal, { status: 'loading' })
    setImages(new Map(states.current))
    const isCurrent = () => epoch.current === currentEpoch
    void (async () => {
      try {
        const result = await mutation.mutateAsync({ previewId, ordinal, refresh: refresh.current.delete(ordinal) })
        if (!isCurrent()) return
        const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
          const image = new Image()
          const finish = () => {
            clearTimeout(timer)
            image.onload = null
            image.onerror = null
            if (cancel.current === fail) cancel.current = null
          }
          const fail = () => {
            finish()
            image.removeAttribute('src')
            reject(new Error('Image unavailable'))
          }
          const timer = setTimeout(fail, 30_000)
          cancel.current = fail
          image.referrerPolicy = 'no-referrer'
          image.onload = () => {
            const width = image.naturalWidth
            const height = image.naturalHeight
            finish()
            if (width > 0 && height > 0) resolve({ width, height })
            else reject(new Error('Image unavailable'))
          }
          image.onerror = fail
          image.src = result.url
        })
        if (isCurrent()) states.current.set(ordinal, { status: 'loaded', url: result.url, ...dimensions })
      } catch {
        if (isCurrent()) states.current.set(ordinal, { status: 'failed' })
      } finally {
        if (isCurrent()) {
          busy.current = false
          setImages(new Map(states.current))
          setRevision((value) => value + 1)
        }
      }
    })()
  }, [enabled, generation, mutation.mutateAsync, ordinals, previewId, revision])

  return {
    images,
    retry(ordinal: number) {
      if (states.current.get(ordinal)?.status === 'loading') return
      states.current.delete(ordinal)
      refresh.current.add(ordinal)
      setImages(new Map(states.current))
      setRevision((value) => value + 1)
    },
    fail(ordinal: number) {
      if (states.current.get(ordinal)?.status === 'failed') return
      states.current.set(ordinal, { status: 'failed' })
      setImages(new Map(states.current))
    }
  }
}
