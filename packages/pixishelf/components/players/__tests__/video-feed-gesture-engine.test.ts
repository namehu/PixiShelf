import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFeedGestureEngine, type FeedGestureEngineOptions } from '../video-feed-gesture-engine'

function createEngine(overrides: Partial<FeedGestureEngineOptions> = {}) {
  let playing = true
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
    onTogglePlayback: vi.fn(() => {
      playing = !playing
    }),
    onSeek: vi.fn((time) => {
      currentTime = time
    }),
    onLike: vi.fn(),
    onOpenActions: vi.fn(),
    getChromeHidden: () => false,
    onExitClearMode: vi.fn(),
    onFeedback: vi.fn(),
    ...overrides
  }
  return { engine: createFeedGestureEngine(options), options, getPlaybackRate: () => playbackRate }
}

const tap = (engine: ReturnType<typeof createFeedGestureEngine>, x: number, id: number) => {
  const event = { pointerId: id, pointerType: 'touch', clientX: x, clientY: 50 }
  engine.pointerDown(event)
  engine.pointerUp(event)
}

describe('createFeedGestureEngine', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('uses a single video tap for playback and a middle double tap for like', () => {
    const single = createEngine()
    tap(single.engine, 50, 1)
    vi.advanceTimersByTime(300)
    expect(single.options.onTogglePlayback).toHaveBeenCalledOnce()

    const double = createEngine()
    tap(double.engine, 50, 1)
    tap(double.engine, 50, 2)
    expect(double.options.onLike).toHaveBeenCalledOnce()
    expect(double.options.onTogglePlayback).not.toHaveBeenCalled()
  })

  it('seeks only in the video edge zones', () => {
    const { engine, options } = createEngine()
    tap(engine, 90, 1)
    tap(engine, 90, 2)
    expect(options.onSeek).toHaveBeenCalledWith(110)
    expect(options.onLike).not.toHaveBeenCalled()
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

  it('opens actions for paused video and lets a clean-mode single tap exit first', () => {
    const paused = createEngine({ getPlaying: () => false })
    paused.engine.pointerDown({ pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 50 })
    vi.advanceTimersByTime(500)
    expect(paused.options.onOpenActions).toHaveBeenCalledOnce()

    const clear = createEngine({ getChromeHidden: () => true })
    tap(clear.engine, 50, 1)
    vi.advanceTimersByTime(300)
    expect(clear.options.onExitClearMode).toHaveBeenCalledOnce()
    expect(clear.options.onTogglePlayback).not.toHaveBeenCalled()
  })

  it('likes anywhere on an image double tap and opens image actions on touch long press', () => {
    const image = createEngine({ mediaKind: 'image' })
    tap(image.engine, 5, 1)
    tap(image.engine, 5, 2)
    expect(image.options.onLike).toHaveBeenCalledOnce()

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
