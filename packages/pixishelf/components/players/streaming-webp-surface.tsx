'use client'

import { useEffect, useRef, useState } from 'react'
import type { PlayerFailure, PlayerSnapshot, WebpPlayer } from '@pixishelf/webp-player'
import { useWebpPlayerStore } from '@/store/use-webp-player-store'

interface Props {
  src: string
  alt: string
  size?: number | null
  playbackKey?: string | number
  paused: boolean
  loop: boolean
  durationMs?: number | null
  onProgress: (snapshot: PlayerSnapshot) => void
  onReady: () => void
  onBuffering: () => void
  onComplete: () => void
  onError: () => void
  onFallback: (failure: PlayerFailure) => void
}

/** React owns the attempt; the player owns frame time, including across pauses. */
export default function StreamingWebpSurface(props: Props) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const player = useRef<WebpPlayer | null>(null)
  const latest = useRef(props)
  latest.current = props
  const [visible, setVisible] = useState(false)
  const { src, size, playbackKey, loop } = props
  useEffect(() => {
    let cancelled = false
    let instance: WebpPlayer | null = null
    setVisible(false)
    void (async () => {
      try {
        const [manifest, { WebpPlayer }] = await Promise.all([
          useWebpPlayerStore.getState().loadManifest(),
          import('@pixishelf/webp-player')
        ])
        if (cancelled || !canvas.current) return
        const base = `/webp-player/${manifest.version}`
        instance = new WebpPlayer(canvas.current, {
          workerUrl: `${base}/worker.mjs`,
          decoderUrl: `${base}/decoder.mjs`
        })
        player.current = instance
        instance.subscribe((event) => {
          if (cancelled) return
          if (event.type === 'first-frame') setVisible(true)
          if (event.type === 'state' || event.type === 'progress') latest.current.onProgress(event.snapshot)
          if (event.type === 'state' && event.snapshot.status === 'playing') latest.current.onReady()
          if (event.type === 'state' && event.snapshot.status === 'buffering') latest.current.onBuffering()
          if (event.type === 'ended') latest.current.onComplete()
          if (event.type === 'error') {
            if (event.error.code === 'initialization') {
              useWebpPlayerStore.getState().invalidateManifest(manifest.version)
            }
            if (event.error.recoverableByLegacy) latest.current.onFallback(event.error)
            else latest.current.onError()
          }
        })
        const ready = instance.load({
          url: src,
          resourceKey: `${src}:${playbackKey}`,
          size: size ?? undefined,
          loop,
          durationMs: latest.current.durationMs
        })
        if (latest.current.paused) instance.pause()
        else instance.play()
        // Structured player errors above already decide retry versus fallback.
        await ready.catch(() => {})
      } catch {
        if (!cancelled) {
          latest.current.onFallback({
            code: 'initialization',
            message: 'WebP playback resources unavailable',
            recoverableByLegacy: true
          })
        }
      }
    })()
    return () => {
      cancelled = true
      instance?.destroy()
      if (player.current === instance) player.current = null
    }
  }, [src, size, playbackKey, loop])
  useEffect(() => {
    if (props.paused) player.current?.pause()
    else if (player.current?.getSnapshot().status === 'ended') void player.current.restart().catch(() => {})
    else player.current?.play()
  }, [props.paused])
  return (
    <canvas
      ref={canvas}
      data-webp-player="wasm"
      data-frame-visible={visible}
      role="img"
      aria-label={props.alt}
      className={`absolute inset-0 h-full w-full object-contain ${visible ? '' : 'invisible'}`}
    />
  )
}
