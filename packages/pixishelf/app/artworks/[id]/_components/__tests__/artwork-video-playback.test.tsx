import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArtworkVideoPlayback } from '../use-artwork-video-playback'
import { useArtworkAutoBrowseStore } from '@/store/use-artwork-auto-browse-store'

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    }
  )
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(0), 16))
  vi.stubGlobal('cancelAnimationFrame', clearTimeout)
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  useArtworkAutoBrowseStore.getState().initialize(1)
})
afterEach(() => {
  cleanup()
  document.body.innerHTML = ''
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('detail video viewport coordinator', () => {
  it('selects only the media at the reading center, pauses in background and under preview', () => {
    const root = document.createElement('div')
    document.body.append(root)
    let offset = 0
    for (let index = 0; index < 3; index++) {
      const node = document.createElement('div')
      node.dataset.autoMediaId = String(index + 1)
      node.dataset.videoMedia = index === 2 ? 'false' : 'true'
      node.getBoundingClientRect = () =>
        ({ top: index * 500 - offset, bottom: (index + 1) * 500 - offset, width: 600, height: 500 }) as DOMRect
      root.append(node)
    }
    const ref = { current: root }
    renderHook(() => useArtworkVideoPlayback(ref))
    act(() => vi.advanceTimersByTime(20))
    expect(useArtworkAutoBrowseStore.getState().activeVideoId).toBe(1)
    act(() => {
      offset = 500
      window.dispatchEvent(new Event('scroll'))
      vi.advanceTimersByTime(20)
    })
    expect(useArtworkAutoBrowseStore.getState().activeVideoId).toBe(2)
    act(() => useArtworkAutoBrowseStore.getState().setActiveAnimation(3))
    act(() => vi.advanceTimersByTime(20))
    expect(useArtworkAutoBrowseStore.getState().activeVideoId).toBeNull()
    act(() => useArtworkAutoBrowseStore.getState().setActiveAnimation(null))
    act(() => vi.advanceTimersByTime(20))
    expect(useArtworkAutoBrowseStore.getState().activeVideoId).toBe(2)
    act(() => useArtworkAutoBrowseStore.getState().setPreviewOpen(true))
    act(() => vi.advanceTimersByTime(20))
    expect(useArtworkAutoBrowseStore.getState().activeVideoId).toBeNull()
    act(() => useArtworkAutoBrowseStore.getState().setPreviewOpen(false))
    act(() => vi.advanceTimersByTime(20))
    expect(useArtworkAutoBrowseStore.getState().activeVideoId).toBe(2)
    act(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, value: true })
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(useArtworkAutoBrowseStore.getState().activeVideoId).toBeNull()
    act(() => {
      offset = 1000
      Object.defineProperty(document, 'hidden', { configurable: true, value: false })
      document.dispatchEvent(new Event('visibilitychange'))
      vi.advanceTimersByTime(20)
    })
    expect(useArtworkAutoBrowseStore.getState().activeVideoId).toBeNull()
  })

  it('retains manual pause per media until the artwork session ends', () => {
    const store = useArtworkAutoBrowseStore
    store.getState().setVideoPaused(1, true)
    store.getState().setActiveVideo(2)
    store.getState().setActiveVideo(1)
    expect(store.getState().pausedVideoIds).toEqual([1])
    store.getState().initialize(2)
    expect(store.getState().pausedVideoIds).toEqual([])
  })
})
