import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'
import { useSourcePreviewAutoBrowse } from '../use-source-preview-auto-browse'

describe('useSourcePreviewAutoBrowse', () => {
  beforeEach(() => {
    localStorage.clear()
    useArtworkAutoBrowseStore.getState().initialize(77)
    useArtworkAutoBrowseStore.getState().setCurrentMedia(901)
    useArtworkAutoBrowseStore.getState().start('scroll')
  })

  afterEach(() => {
    cleanup()
    useArtworkAutoBrowseStore.getState().release(useArtworkAutoBrowseStore.getState().session)
  })

  it('shares preferences with local browsing without changing its runtime identity or playback', async () => {
    const before = useArtworkAutoBrowseStore.getState()
    const { result } = renderHook(() => useSourcePreviewAutoBrowse('opaque-preview'))

    act(() => result.current.setPreferences({ scrollSpeed: 300, slideSeconds: 0.5, loop: true }))

    await waitFor(() => expect(result.current.state.scrollSpeed).toBe(300))
    expect(result.current.state).toMatchObject({ slideSeconds: 0.5, loop: true })
    expect(useArtworkAutoBrowseStore.getState()).toMatchObject({
      scrollSpeed: 300,
      slideSeconds: 0.5,
      loop: true,
      artworkId: before.artworkId,
      currentMediaId: before.currentMediaId,
      mode: before.mode,
      status: before.status,
      session: before.session
    })

    act(() => result.current.start('slideshow'))
    expect(result.current.state.mode).toBe('slideshow')
    expect(useArtworkAutoBrowseStore.getState()).toMatchObject({
      artworkId: 77,
      currentMediaId: 901,
      mode: 'scroll',
      status: 'running'
    })
  })
})
