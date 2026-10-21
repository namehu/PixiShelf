import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFeedGestureEngine, type FeedGestureEngineOptions } from '../video-feed-gesture-engine'

function createEngine(overrides: Partial<FeedGestureEngineOptions> = {}) {
  const playing = true
  let currentTime = 100
  let playbackRate = 1
  const options: FeedGestureEngineOptions = {
    mediaKind: 'video',
    longPressRate: 3,
    seekStepSeconds: 10,
    getSurfaceRect: () => ({ left: 0, width: 100 }),
    getPlaying: () => playing,
    getCurrentTime: () => currentTime,
    getDuration: () => 1000,
    getPlaybackRate: () => playbackRate,
    setPlaybackRate: (rate) => {
      playbackRate = rate
    },
    onToggleChrome: vi.fn(),
    onSeek: vi.fn((time) => {
      currentTime = time
    }),
    onTogglePlayback: vi.fn(),
    onOpenActions: vi.fn(),
    onFeedback: vi.fn(),
    ...overrides
  }
  return { engine: createFeedGestureEngine(options), options, getPlaybackRate: () => playbackRate }
}

const tap = (engine: ReturnType<typeof createFeedGestureEngine>, x: number, id: number, pointerType = 'touch') => {
  const event = { pointerId: id, pointerType, button: 0, clientX: x, clientY: 50 }
  engine.pointerDown(event)
  engine.pointerUp(event)
}

describe('createFeedGestureEngine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it.each(['touch', 'mouse', 'pen'])(
    'uses a single tap for chrome and a middle double tap for playback (%s)',
    (pointerType) => {
      const single = createEngine()
      tap(single.engine, 50, 1)
      vi.advanceTimersByTime(300)
      expect(single.options.onToggleChrome).toHaveBeenCalledOnce()

      const double = createEngine()
      tap(double.engine, 50, 1, pointerType)
      tap(double.engine, 50, 2, pointerType)
      vi.advanceTimersByTime(300)
      expect(double.options.onTogglePlayback).toHaveBeenCalledOnce()
      expect(double.options.onToggleChrome).not.toHaveBeenCalled()
    }
  )

  it.each(['image', 'video'] as const)(
    'toggles chrome in both directions for %s without changing playback',
    (mediaKind) => {
      let hidden = false
      const { engine, options } = createEngine({
        mediaKind,
        onToggleChrome: vi.fn(() => {
          hidden = !hidden
        })
      })
      tap(engine, 50, 1)
      vi.advanceTimersByTime(299)
      expect(hidden).toBe(false)
      vi.advanceTimersByTime(1)
      expect(hidden).toBe(true)
      tap(engine, 50, 2)
      vi.advanceTimersByTime(300)
      expect(hidden).toBe(false)
      expect(options.getPlaying()).toBe(true)
    }
  )

  it.each(['cancel', 'destroy', 'drag'] as const)('cancels pending taps on %s', (action) => {
    const { engine, options } = createEngine()
    tap(engine, 50, 1)
    if (action === 'cancel') engine.pointerCancel()
    if (action === 'destroy') engine.destroy()
    if (action === 'drag') {
      engine.pointerDown({ pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 50 })
      engine.pointerMove({ pointerId: 2, pointerType: 'touch', clientX: 80, clientY: 50 })
      engine.pointerUp({ pointerId: 2, pointerType: 'touch', clientX: 80, clientY: 50 })
    }
    vi.runAllTimers()
    expect(options.onToggleChrome).not.toHaveBeenCalled()
    expect(options.onTogglePlayback).not.toHaveBeenCalled()
  })

  it.each([
    [10, 90],
    [90, 110]
  ])('seeks only in the video edge zone at %s', (x, time) => {
    const { engine, options } = createEngine()
    tap(engine, x, 1)
    tap(engine, x, 2)
    expect(options.onSeek).toHaveBeenCalledWith(time)
    expect(options.onTogglePlayback).not.toHaveBeenCalled()
  })

  it('temporarily changes playback rate and cancels when movement wins', () => {
    const first = createEngine()
    first.engine.pointerDown({ pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 50 })
    vi.advanceTimersByTime(1000)
    expect(first.getPlaybackRate()).toBe(3)
    first.engine.pointerUp({ pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 50 })
    expect(first.getPlaybackRate()).toBe(1)

    const moved = createEngine()
    moved.engine.pointerDown({ pointerId: 2, pointerType: 'touch', clientX: 50, clientY: 50 })
    moved.engine.pointerMove({ pointerId: 2, pointerType: 'touch', clientX: 64, clientY: 50 })
    vi.advanceTimersByTime(1000)
    expect(moved.getPlaybackRate()).toBe(1)
  })

  it.each([0.5, 1.5, 3])('restores selected %s× after long press and never slows it down', (selected) => {
    const { engine, options, getPlaybackRate } = createEngine({ longPressRate: 2 })
    options.setPlaybackRate(selected)
    const event = { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 50 }
    engine.pointerDown(event)
    vi.advanceTimersByTime(1000)
    expect(getPlaybackRate()).toBe(Math.max(selected, 2))
    engine.pointerUp(event)
    expect(getPlaybackRate()).toBe(selected)
    engine.pointerDown(event)
    vi.advanceTimersByTime(1000)
    engine.pointerCancel()
    expect(getPlaybackRate()).toBe(selected)
    engine.destroy()
  })

  it('opens actions for paused video without toggling chrome', () => {
    const paused = createEngine({ getPlaying: () => false })
    paused.engine.pointerDown({ pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 50 })
    vi.advanceTimersByTime(500)
    expect(paused.options.onOpenActions).toHaveBeenCalledOnce()

    paused.engine.pointerUp({ pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 50 })
    vi.advanceTimersByTime(300)
    expect(paused.options.onToggleChrome).not.toHaveBeenCalled()
  })

  it.each([5, 50, 95])('ignores image double taps at %s and preserves touch long press', (x) => {
    const image = createEngine({ mediaKind: 'image' })
    tap(image.engine, x, 1)
    tap(image.engine, x, 2)
    vi.advanceTimersByTime(300)
    expect(image.options.onTogglePlayback).not.toHaveBeenCalled()
    expect(image.options.onToggleChrome).not.toHaveBeenCalled()
    expect(image.options.onSeek).not.toHaveBeenCalled()

    image.engine.pointerDown({ pointerId: 3, pointerType: 'touch', clientX: 50, clientY: 50 })
    vi.advanceTimersByTime(500)
    expect(image.options.onOpenActions).toHaveBeenCalledOnce()
  })

  it('does not start long-press speed-up for a mouse pointer', () => {
    const mouse = createEngine()
    mouse.engine.pointerDown({ pointerId: 1, pointerType: 'mouse', button: 0, clientX: 50, clientY: 50 })
    vi.advanceTimersByTime(1000)
    expect(mouse.getPlaybackRate()).toBe(1)
  })
})
