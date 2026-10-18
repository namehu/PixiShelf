'use client'

import { useCallback, useState } from 'react'
import { isVideoReadingComplete, type ReadingPlayback } from '@pixishelf/db/reading-contract'

export interface VideoReadingProgress extends ReadingPlayback {
  started: boolean
  playing: boolean
}

/** Publish only start/completion/play-state transitions, not every playback tick. */
export function useVideoReading(key: string, enabled: boolean) {
  const [snapshot, setSnapshot] = useState<{ key: string; progress: VideoReadingProgress } | null>(null)
  const onProgress = useCallback((progress: VideoReadingProgress) => {
    if (!enabled || document.hidden || !navigator.onLine || !progress.started) return
    const next = {
      ...progress,
      currentTime: Number.isFinite(progress.currentTime) ? Math.max(0, progress.currentTime) : 0,
      duration: Number.isFinite(progress.duration) ? Math.max(0, progress.duration) : 0
    }
    setSnapshot((prior) => {
      if (prior?.key === key && isVideoReadingComplete(prior.progress)) {
        return prior.progress.playing === next.playing ? prior :
          { key, progress: { ...prior.progress, playing: next.playing } }
      }
      if (prior?.key === key && prior.progress.playing === next.playing &&
        isVideoReadingComplete(prior.progress) === isVideoReadingComplete(next)) return prior
      return { key, progress: next }
    })
  }, [enabled, key])
  return { playback: snapshot?.key === key ? snapshot.progress : null, onProgress }
}
