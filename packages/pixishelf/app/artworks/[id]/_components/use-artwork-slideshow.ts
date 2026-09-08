'use client'

import { useEffect } from 'react'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'

export function useArtworkSlideshow({
  index,
  count,
  ready,
  error,
  blocked,
  transitioning,
  onNext,
  onFirst,
  enabled
}: {
  index: number
  count: number
  ready: boolean
  error: boolean
  blocked: boolean
  transitioning: boolean
  enabled: boolean
  onNext: () => void
  onFirst: () => void
}) {
  const active = useArtworkAutoBrowseStore(
    (state) => state.mode === 'slideshow' && ['running', 'waiting'].includes(state.status)
  )
  const revision = useArtworkAutoBrowseStore((state) => state.revision)
  useEffect(() => {
    if (!active || !enabled) return
    const store = useArtworkAutoBrowseStore
    const state = store.getState()
    if (blocked) {
      state.pause('zoom')
      return
    }
    if (error) {
      state.pause('error')
      return
    }
    if (!ready || transitioning) {
      state.wait()
      return
    }
    state.ready()
    const { session, currentMediaId } = state
    const timeout = window.setTimeout(() => {
      const latest = store.getState()
      if (
        latest.session !== session ||
        latest.revision !== revision ||
        latest.currentMediaId !== currentMediaId ||
        latest.mode !== 'slideshow' ||
        latest.status !== 'running'
      ) {
        return
      }
      if (index < count - 1) onNext()
      else if (latest.loop && count > 1) onFirst()
      else latest.end()
    }, state.slideSeconds * 1000)
    return () => window.clearTimeout(timeout)
  }, [active, blocked, count, enabled, error, index, onFirst, onNext, ready, revision, transitioning])
}
