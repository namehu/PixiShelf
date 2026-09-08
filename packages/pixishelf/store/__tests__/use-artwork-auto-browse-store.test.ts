import { beforeEach, describe, expect, it } from 'vitest'
import { AUTO_BROWSE_STORAGE_KEY, useArtworkAutoBrowseStore as store } from '../use-artwork-auto-browse-store'

describe('artwork auto browse store', () => {
  beforeEach(() => {
    store.getState().initialize(1)
    store.getState().setPreferences({ scrollSpeed: 40, slideSeconds: 5, loop: false })
    localStorage.clear()
  })

  it('switches modes atomically and does not resume a user pause after loading', () => {
    store.getState().start('scroll')
    store.getState().wait()
    store.getState().pause()
    store.getState().ready()
    expect(store.getState()).toMatchObject({ mode: 'scroll', status: 'paused' })
    store.getState().start('slideshow')
    expect(store.getState()).toMatchObject({ mode: 'slideshow', status: 'running' })
  })

  it('acknowledges the current video on resume and clears acknowledgements for a loop', () => {
    store.getState().start('scroll')
    store.getState().setCurrentMedia(7)
    store.getState().pause('video')
    store.getState().resume()
    expect(store.getState().skippedIds).toEqual([7])
    store.getState().resetCycle()
    expect(store.getState().skippedIds).toEqual([])
  })

  it('resets runtime between artworks and ignores cleanup from an older session', () => {
    const old = store.getState().session
    store.getState().start('slideshow')
    store.getState().setPreferences({ loop: true })
    const current = store.getState().initialize(2)
    store.getState().release(old)
    expect(store.getState()).toMatchObject({ artworkId: 2, session: current, status: 'idle', mode: null, loop: true })
    store.getState().release(current)
    store.getState().start('scroll')
    expect(store.getState()).toMatchObject({ artworkId: null, status: 'idle' })
  })

  it('persists only preferences and ignores injected playback state during hydration', async () => {
    store.getState().start('scroll')
    const saved = JSON.parse(localStorage.getItem(AUTO_BROWSE_STORAGE_KEY)!)
    expect(saved.state).toEqual({ scrollSpeed: 40, slideSeconds: 5, loop: false })
    localStorage.setItem(
      AUTO_BROWSE_STORAGE_KEY,
      JSON.stringify({
        version: 0,
        state: {
          scrollSpeed: 80,
          slideSeconds: 8,
          loop: true,
          artworkId: 99,
          mode: 'slideshow',
          status: 'running',
          start: null
        }
      })
    )
    await store.persist.rehydrate()
    expect(store.getState()).toMatchObject({
      artworkId: 1,
      mode: 'scroll',
      scrollSpeed: 80,
      slideSeconds: 8,
      loop: true
    })
    expect(typeof store.getState().start).toBe('function')
  })

  it('bounds invalid settings and falls back after malformed storage', async () => {
    store.getState().setPreferences({ scrollSpeed: Infinity, slideSeconds: -5 })
    expect(store.getState()).toMatchObject({ scrollSpeed: 40, slideSeconds: 2 })
    localStorage.setItem(AUTO_BROWSE_STORAGE_KEY, '{broken')
    await store.persist.rehydrate()
    store.getState().start('scroll')
    expect(store.getState().status).toBe('running')
  })
})
