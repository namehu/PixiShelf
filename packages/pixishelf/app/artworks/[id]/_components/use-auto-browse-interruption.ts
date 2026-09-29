'use client'

import { useEffect } from 'react'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'

export function useAutoBrowseInterruption(artworkId: number) {
  useEffect(() => {
    const store = useArtworkAutoBrowseStore
    void store.persist.rehydrate()
    const session = store.getState().initialize(artworkId)
    const pause = () => store.getState().pause('manual')
    const visibility = () => {
      if (document.hidden) store.getState().pause('hidden')
    }
    const pointer = (event: Event) => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-auto-browse-controls]')) return
      pause()
    }
    const keydown = (event: KeyboardEvent) => {
      if (
        ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End'].includes(event.key)
      ) {
        pause()
        return
      }
      const target = event.target
      if (
        target instanceof Element &&
        target.closest(
          'input, textarea, select, button, a, [role="slider"], [contenteditable="true"], video, .art-video-player'
        )
      ) {
        return
      }
      const state = store.getState()
      if (!state.mode) return
      if (event.code === 'Space' && !event.repeat && !document.querySelector('[data-auto-browse-settings]')) {
        event.preventDefault()
        if (state.status === 'running' || state.status === 'waiting') state.pause()
        else if (state.status === 'paused' && state.reason !== 'zoom' && state.reason !== 'error') state.resume()
      }
    }
    // Input events distinguish human takeover from our own scroll/Swiper events.
    document.addEventListener('pointerdown', pointer, true)
    document.addEventListener('wheel', pause, { passive: true, capture: true })
    document.addEventListener('touchmove', pointer, { passive: true, capture: true })
    document.addEventListener('keydown', keydown, true)
    document.addEventListener('visibilitychange', visibility)
    const pagehide = () => store.getState().pause('hidden')
    window.addEventListener('pagehide', pagehide)
    return () => {
      document.removeEventListener('pointerdown', pointer, true)
      document.removeEventListener('wheel', pause, true)
      document.removeEventListener('touchmove', pointer, true)
      document.removeEventListener('keydown', keydown, true)
      document.removeEventListener('visibilitychange', visibility)
      window.removeEventListener('pagehide', pagehide)
      store.getState().release(session)
    }
  }, [artworkId])
}
