import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArtworkAutoBrowseStore as store, AUTO_BROWSE_STORAGE_KEY } from '@/store/use-artwork-auto-browse-store'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkSlideshow } from '../use-artwork-slideshow'
import { useArtworkAutoScroll } from '../use-artwork-auto-scroll'
import { useAutoBrowseInterruption } from '../use-auto-browse-interruption'

beforeEach(() => {
  vi.useFakeTimers()
  store.getState().initialize(1)
  store.getState().setPreferences({ scrollSpeed: 40, slideSeconds: 5, loop: false })
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
  document.body.innerHTML = ''
})

describe('slideshow clock', () => {
  function setup() {
    const onNext = vi.fn()
    const onFirst = vi.fn()
    store.getState().start('slideshow')
    const props = {
      index: 0,
      count: 3,
      ready: false,
      error: false,
      blocked: false,
      transitioning: false,
      enabled: true,
      onNext,
      onFirst
    }
    const hook = renderHook((options) => useArtworkSlideshow(options), { initialProps: props })
    return { ...hook, props, onNext, onFirst }
  }
  it('waits for decoding and transitions, then gives the image a full interval', () => {
    const { rerender, props, onNext } = setup()
    act(() => vi.advanceTimersByTime(10000))
    expect(onNext).not.toHaveBeenCalled()
    rerender({ ...props, ready: true, transitioning: true })
    act(() => vi.advanceTimersByTime(10000))
    expect(onNext).not.toHaveBeenCalled()
    rerender({ ...props, ready: true })
    act(() => vi.advanceTimersByTime(4999))
    expect(onNext).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onNext).toHaveBeenCalledTimes(1)
  })
  it('cancels immediately on pause and restarts the full interval on resume', () => {
    const { rerender, props, onNext } = setup()
    rerender({ ...props, ready: true })
    act(() => vi.advanceTimersByTime(4000))
    act(() => store.getState().pause())
    act(() => vi.advanceTimersByTime(10000))
    expect(onNext).not.toHaveBeenCalled()
    act(() => store.getState().resume())
    act(() => vi.advanceTimersByTime(4999))
    expect(onNext).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onNext).toHaveBeenCalledTimes(1)
  })
  it('pauses on errors and zoom and does not resume merely because loading succeeds', () => {
    const { rerender, props, onNext } = setup()
    rerender({ ...props, error: true })
    expect(store.getState()).toMatchObject({ status: 'paused', reason: 'error' })
    rerender({ ...props, ready: true })
    act(() => vi.advanceTimersByTime(10000))
    expect(onNext).not.toHaveBeenCalled()
    act(() => store.getState().resume())
    rerender({ ...props, ready: true, blocked: true })
    expect(store.getState()).toMatchObject({ status: 'paused', reason: 'zoom' })
  })
  it('stops at the end, loops only when enabled, and cleans up on unmount', () => {
    const { rerender, props, onFirst, onNext, unmount } = setup()
    rerender({ ...props, index: 2, ready: true })
    act(() => vi.advanceTimersByTime(5000))
    expect(store.getState().status).toBe('ended')
    expect(onFirst).not.toHaveBeenCalled()
    act(() => {
      store.getState().setPreferences({ loop: true })
      store.getState().resume()
    })
    act(() => vi.advanceTimersByTime(5000))
    expect(onFirst).toHaveBeenCalledTimes(1)
    rerender({ ...props, index: 0, ready: true })
    unmount()
    act(() => vi.advanceTimersByTime(5000))
    expect(onNext).not.toHaveBeenCalled()
  })
  it('rejects a timer from a different artwork session', () => {
    const { rerender, props, onNext } = setup()
    rerender({ ...props, ready: true })
    act(() => {
      store.getState().initialize(2)
      store.getState().start('scroll')
    })
    act(() => vi.advanceTimersByTime(10000))
    expect(onNext).not.toHaveBeenCalled()
  })
})

describe('scroll driver', () => {
  function setup({ status = 'ready', video = false, height = 2000, expanded = true } = {}) {
    let scrollY = 0
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.spyOn(window, 'scrollTo').mockImplementation((options: number | ScrollToOptions) => {
      if (typeof options === 'object') scrollY = Math.round(options.top ?? 0)
    })
    const container = document.createElement('div')
    container.innerHTML = `<div data-index="0"><div data-preview-status="${status}"></div></div>`
    document.body.append(container)
    const rect = () => ({
      top: -scrollY,
      bottom: height - scrollY,
      height,
      width: 600,
      left: 0,
      right: 600,
      x: 0,
      y: -scrollY,
      toJSON() {}
    })
    vi.spyOn(container, 'getBoundingClientRect').mockImplementation(rect)
    vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockImplementation(rect)
    const frames = new Map<number, FrameRequestCallback>()
    let id = 0
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.set(++id, callback)
      return id
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((frame) => {
      frames.delete(frame)
    })
    const advance = (time: number) =>
      act(() => {
        const pending = [...frames.values()]
        frames.clear()
        pending.forEach((callback) => callback(time))
      })
    const expand = vi.fn()
    const images = [
      { id: 1, path: video ? '/1.mp4' : '/1.jpg', mediaType: video ? 'video' : 'image' }
    ] as ArtworkImageResponseDto[]
    const props = { containerRef: { current: container }, images, expanded, expand }
    store.getState().start('scroll')
    const hook = renderHook((options) => useArtworkAutoScroll(options), { initialProps: props })
    return { ...hook, props, container, expand, advance, frames, getY: () => scrollY }
  }
  it('expands the list before starting', () => {
    const { expand, frames } = setup({ expanded: false })
    expect(expand).toHaveBeenCalledTimes(1)
    expect(frames.size).toBe(0)
  })
  it('accumulates fractional low-speed movement and clamps long frames', () => {
    const { advance, getY } = setup()
    act(() => store.getState().setPreferences({ scrollSpeed: 10 }))
    for (let time = 0; time <= 1000; time += 10) advance(time)
    expect(getY()).toBe(10)
    advance(100000)
    expect(getY()).toBeLessThanOrEqual(11)
  })
  it('waits for media, continues on load and pauses on an error', () => {
    const { advance, getY, container } = setup({ status: 'loading' })
    advance(0)
    advance(50)
    expect(store.getState().status).toBe('waiting')
    expect(getY()).toBe(0)
    container.querySelector('[data-preview-status]')!.setAttribute('data-preview-status', 'ready')
    advance(100)
    expect(store.getState().status).toBe('running')
    expect(getY()).toBeGreaterThan(0)
    container.querySelector('[data-preview-status]')!.setAttribute('data-preview-status', 'error')
    advance(150)
    expect(store.getState()).toMatchObject({ status: 'paused', reason: 'error' })
  })
  it('pauses once at a video and allows explicit continuation', () => {
    const { advance, getY } = setup({ video: true })
    advance(0)
    expect(store.getState()).toMatchObject({ status: 'paused', reason: 'video' })
    act(() => store.getState().resume())
    advance(50)
    advance(100)
    expect(getY()).toBeGreaterThan(0)
    expect(store.getState().status).toBe('running')
  })
  it('ends at the measured media bottom and never scrolls further', () => {
    const { advance, getY } = setup({ height: 800 })
    advance(0)
    expect(store.getState().status).toBe('ended')
    advance(10000)
    expect(getY()).toBe(0)
  })
  it('does not end on an unloaded final image and clears pending frames on exit', () => {
    const { advance, frames, unmount } = setup({ height: 800, status: 'loading' })
    advance(0)
    expect(store.getState().status).toBe('waiting')
    expect(frames.size).toBe(1)
    unmount()
    expect(frames.size).toBe(0)
  })
})

describe('human takeover', () => {
  it('pauses keyboard navigation even when a preview button has focus', () => {
    renderHook(() => useAutoBrowseInterruption(4))
    const button = document.createElement('button')
    document.body.append(button)
    button.focus()
    act(() => store.getState().start('slideshow'))
    act(() => button.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
    expect(store.getState().status).toBe('paused')
  })
  it('restores saved preferences before initialization and pauses for input, not scroll events', () => {
    localStorage.setItem(
      AUTO_BROWSE_STORAGE_KEY,
      JSON.stringify({ version: 0, state: { scrollSpeed: 80, slideSeconds: 8, loop: true } })
    )
    const { unmount } = renderHook(() => useAutoBrowseInterruption(4))
    expect(store.getState()).toMatchObject({
      artworkId: 4,
      scrollSpeed: 80,
      slideSeconds: 8,
      loop: true,
      status: 'idle'
    })
    act(() => store.getState().start('scroll'))
    act(() => document.dispatchEvent(new Event('scroll')))
    expect(store.getState().status).toBe('running')
    act(() => document.dispatchEvent(new Event('wheel')))
    expect(store.getState().status).toBe('paused')
    act(() => store.getState().resume())
    act(() => window.dispatchEvent(new Event('pagehide')))
    expect(store.getState()).toMatchObject({ status: 'paused', reason: 'hidden' })
    unmount()
    expect(store.getState()).toMatchObject({ artworkId: null, status: 'idle', scrollSpeed: 80 })
  })
})
