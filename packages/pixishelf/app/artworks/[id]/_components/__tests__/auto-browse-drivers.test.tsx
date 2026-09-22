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
  store.getState().setPreferences({ scrollSpeed: 40, slideSeconds: 0.5, loop: false })
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
    act(() => vi.advanceTimersByTime(499))
    expect(onNext).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(onNext).toHaveBeenCalledTimes(1)
  })
  it('cancels immediately on pause and restarts the full interval on resume', () => {
    const { rerender, props, onNext } = setup()
    rerender({ ...props, ready: true })
    act(() => vi.advanceTimersByTime(400))
    act(() => store.getState().pause())
    act(() => vi.advanceTimersByTime(10000))
    expect(onNext).not.toHaveBeenCalled()
    act(() => store.getState().resume())
    act(() => vi.advanceTimersByTime(499))
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
    act(() => vi.advanceTimersByTime(500))
    expect(store.getState().status).toBe('ended')
    expect(onFirst).not.toHaveBeenCalled()
    act(() => {
      store.getState().setPreferences({ loop: true })
      store.getState().resume()
    })
    act(() => vi.advanceTimersByTime(500))
    expect(onFirst).toHaveBeenCalledTimes(1)
    rerender({ ...props, index: 0, ready: true })
    unmount()
    act(() => vi.advanceTimersByTime(500))
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
  function setup({ status = 'ready', video = false, animated = false, height = 2000, expanded = true } = {}) {
    let scrollY = 0
    Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 })
    vi.spyOn(window, 'scrollTo').mockImplementation((options: number | ScrollToOptions) => {
      if (typeof options === 'object') scrollY = Math.round(options.top ?? 0)
    })
    const container = document.createElement('div')
    container.innerHTML = `<div data-index="0"><div data-preview-status="${status}" data-animation-duration-ms="5000"></div></div>`
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
      {
        id: 1,
        path: video ? '/1.mp4' : animated ? '/1.webp' : '/1.jpg',
        mediaType: video ? 'video' : 'image',
        isAnimated: animated
      }
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
    act(() => store.getState().setPreferences({ scrollSpeed: 50 }))
    for (let time = 0; time <= 1000; time += 10) advance(time)
    expect(getY()).toBe(50)
    advance(100000)
    expect(getY()).toBeLessThanOrEqual(54)
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
  it('waits for the animation to load, plays its actual duration and continues only once per cycle', () => {
    const { advance, container, getY } = setup({ animated: true })
    const player = container.querySelector('[data-preview-status]')!
    player.setAttribute('data-animation-duration-ms', '2300')
    player.setAttribute('data-animation-status', 'loading')
    advance(0)
    expect(store.getState()).toMatchObject({ activeAnimationId: 1, status: 'waiting' })
    advance(10000)
    expect(getY()).toBe(0)
    player.setAttribute('data-animation-status', 'ready')
    advance(10001)
    advance(12300)
    expect(getY()).toBe(0)
    expect(store.getState().activeAnimationId).toBe(1)
    advance(12301)
    expect(store.getState()).toMatchObject({ activeAnimationId: null, skippedIds: [1] })
    advance(12351)
    expect(getY()).toBeGreaterThan(0)
    expect(store.getState().activeAnimationId).toBeNull()
  })
  it('cancels playback on pause and gives it a full dwell after resuming', () => {
    const { advance, container, unmount } = setup({ animated: true })
    container.querySelector('[data-preview-status]')!.setAttribute('data-animation-status', 'ready')
    advance(0)
    advance(1)
    advance(4000)
    act(() => store.getState().pause('hidden'))
    expect(store.getState().activeAnimationId).toBeNull()
    advance(20000)
    expect(store.getState().skippedIds).toEqual([])
    act(() => store.getState().resume())
    advance(20001)
    advance(20002)
    advance(25001)
    expect(store.getState().activeAnimationId).toBe(1)
    unmount()
    expect(store.getState().activeAnimationId).toBeNull()
  })
  it('plays the final animation before ending and replays it on the next loop', () => {
    const { advance, container } = setup({ animated: true, height: 800 })
    container.querySelector('[data-preview-status]')!.setAttribute('data-animation-status', 'ready')
    act(() => store.getState().setPreferences({ loop: true }))
    advance(0)
    advance(1)
    advance(5001)
    expect(store.getState().skippedIds).toEqual([1])
    advance(5002)
    advance(7002)
    expect(store.getState().skippedIds).toEqual([])
    advance(7003)
    expect(store.getState().activeAnimationId).toBe(1)
  })
  it('pauses on an animation error and allows skipping it', () => {
    const { advance, container, getY } = setup({ animated: true })
    container.querySelector('[data-preview-status]')!.setAttribute('data-animation-status', 'error')
    advance(0)
    advance(1)
    expect(store.getState()).toMatchObject({ status: 'paused', reason: 'error', activeAnimationId: null })
    act(() => {
      store.getState().skip(1)
      store.getState().resume()
    })
    advance(2)
    advance(52)
    expect(getY()).toBeGreaterThan(0)
  })
  it('does not auto-play static or unconfirmed WebP files', () => {
    const { advance, props, rerender, getY } = setup()
    rerender({
      ...props,
      images: [{ ...props.images[0]!, path: '/static.webp', isAnimated: false, webpAnimationStatus: 0 }]
    })
    advance(0)
    advance(50)
    expect(getY()).toBeGreaterThan(0)
    expect(store.getState().activeAnimationId).toBeNull()
  })
  it('does not let an adjacent unloaded preview delay the current animation clock', () => {
    const { advance, props, rerender, container } = setup({ animated: true })
    const next = document.createElement('div')
    next.dataset.index = '1'
    next.innerHTML = '<div data-preview-status="loading"></div>'
    next.getBoundingClientRect = () => ({ top: 600, bottom: 1000, width: 600, height: 400 }) as DOMRect
    container.append(next)
    rerender({ ...props, images: [...props.images, { id: 2, path: '/2.jpg' } as ArtworkImageResponseDto] })
    container.querySelector('[data-preview-status]')!.setAttribute('data-animation-status', 'ready')
    advance(0)
    advance(1)
    advance(5001)
    expect(store.getState()).toMatchObject({ activeAnimationId: null, skippedIds: [1] })
    advance(5002)
    expect(store.getState().status).toBe('waiting')
  })
  it('plays short animations in reading order even when the viewport center is on a video', () => {
    const { advance, props, rerender, container } = setup({ animated: true })
    vi.spyOn(container.firstElementChild!, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          top: 0,
          bottom: 100,
          width: 600,
          height: 100
        }) as DOMRect
    )
    const next = document.createElement('div')
    next.dataset.index = '1'
    next.getBoundingClientRect = () => ({ top: 100, bottom: 2000, width: 600, height: 1900 }) as DOMRect
    container.append(next)
    rerender({
      ...props,
      images: [...props.images, { id: 2, path: '/2.mp4', mediaType: 'video' } as ArtworkImageResponseDto]
    })
    advance(0)
    expect(store.getState()).toMatchObject({ activeAnimationId: 1, status: 'waiting' })
    container.querySelector('[data-preview-status]')!.setAttribute('data-animation-status', 'ready')
    advance(1)
    advance(5001)
    advance(5002)
    expect(store.getState()).toMatchObject({ activeAnimationId: null, status: 'paused', reason: 'video' })
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
      scrollSpeed: 100,
      slideSeconds: 3,
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
    expect(store.getState()).toMatchObject({ artworkId: null, status: 'idle', scrollSpeed: 100 })
  })
})
