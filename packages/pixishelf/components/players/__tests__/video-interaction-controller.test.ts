import { fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type Artplayer from 'artplayer'
import {
  createVideoInteractionPlugin,
  getDoubleTapAction,
  getGestureSeekTarget,
  getGestureSeekWindow,
  type VideoInteractionFeedback,
  type VideoInteractionPluginApi
} from '../video-interaction-controller'

interface TestPlayer {
  art: Artplayer
  api: VideoInteractionPluginApi
  surface: HTMLElement
  progress: HTMLElement
  feedback: ReturnType<typeof vi.fn<(feedback: VideoInteractionFeedback | null) => void>>
  controlsVisible: { current: boolean }
}

function createTestPlayer({ duration = 1000, currentTime = 100, playing = true } = {}): TestPlayer {
  const player = document.createElement('div')
  const layerRoot = document.createElement('div')
  const progress = document.createElement('div')
  player.append(layerRoot, progress)
  document.body.append(player)

  Object.defineProperty(progress, 'getBoundingClientRect', {
    value: () => ({ left: 0, width: 100, right: 100, top: 0, bottom: 10, height: 10, x: 0, y: 0, toJSON() {} })
  })

  let isPlaying = playing
  const layerElements = new Map<string, HTMLElement>()
  const layers: Record<string, unknown> & {
    add: (option: any) => HTMLElement
    remove: (name: string) => void
  } = {
    add(option) {
      const element = document.createElement('div')
      layerRoot.append(element)
      layerElements.set(option.name, element)
      layers[option.name] = element
      option.mounted?.(element)
      return element
    },
    remove(name) {
      layerElements.get(name)?.remove()
      layerElements.delete(name)
      delete layers[name]
    }
  }

  const art = {
    currentTime,
    duration,
    playbackRate: 1,
    get playing() {
      return isPlaying
    },
    pause: vi.fn(() => {
      isPlaying = false
    }),
    play: vi.fn(async () => {
      isPlaying = true
    }),
    emit: vi.fn(),
    isFocus: true,
    isInput: false,
    template: { $progress: progress },
    layers,
    plugins: {}
  } as unknown as Artplayer

  const feedback = vi.fn<(feedback: VideoInteractionFeedback | null) => void>()
  const controlsVisible = { current: true }
  const api = createVideoInteractionPlugin({
    longPressRate: 3,
    seekStepSeconds: 10,
    getChapterAt: () => undefined,
    onFeedback: feedback,
    setControlsVisible: (visible) => {
      controlsVisible.current = visible
    },
    getControlsVisible: () => controlsVisible.current
  })(art)
  const surface = player.querySelector<HTMLElement>('.pixishelf-video-gesture-surface')!
  Object.defineProperty(surface, 'getBoundingClientRect', {
    value: () => ({ left: 0, width: 100, right: 100, top: 0, bottom: 100, height: 100, x: 0, y: 0, toJSON() {} })
  })

  return { art, api, surface, progress, feedback, controlsVisible }
}

describe('video interaction calculations', () => {
  it('uses a duration-relative seek window bounded between 30 seconds and 5 minutes', () => {
    expect(getGestureSeekWindow(120)).toBe(30)
    expect(getGestureSeekWindow(1200)).toBe(120)
    expect(getGestureSeekWindow(7200)).toBe(300)
  })

  it('calculates a clamped relative gesture target', () => {
    expect(getGestureSeekTarget({ startTime: 100, duration: 1000, deltaX: 50, width: 100 })).toBe(150)
    expect(getGestureSeekTarget({ startTime: 5, duration: 1000, deltaX: -100, width: 100 })).toBe(0)
  })

  it('uses 20 percent edge zones for seek and the middle for playback', () => {
    const rect = { left: 0, width: 100 }
    expect(getDoubleTapAction(10, rect)).toBe('backward')
    expect(getDoubleTapAction(50, rect)).toBe('toggle-playback')
    expect(getDoubleTapAction(90, rect)).toBe('forward')
  })
})

describe('video interaction controller', () => {
  const activePlugins: VideoInteractionPluginApi[] = []

  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    activePlugins.splice(0).forEach((plugin) => plugin.destroy())
    document.body.innerHTML = ''
    vi.useRealTimers()
  })

  const setup = (options?: Parameters<typeof createTestPlayer>[0]) => {
    const testPlayer = createTestPlayer(options)
    activePlugins.push(testPlayer.api)
    return testPlayer
  }

  const tap = (surface: HTMLElement, x: number, pointerId: number) => {
    fireEvent.pointerDown(surface, { pointerId, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 50 })
    fireEvent.pointerUp(surface, { pointerId, pointerType: 'touch', isPrimary: true, clientX: x, clientY: 50 })
  }

  it('delays a single tap before toggling the fixed control state', () => {
    const { surface, controlsVisible } = setup()

    tap(surface, 50, 1)
    expect(controlsVisible.current).toBe(true)
    vi.advanceTimersByTime(300)
    expect(controlsVisible.current).toBe(false)
  })

  it('turns a right-zone double tap into one seek without toggling controls', () => {
    const { art, surface, controlsVisible } = setup()

    tap(surface, 90, 1)
    tap(surface, 90, 2)

    expect(art.currentTime).toBe(110)
    vi.advanceTimersByTime(300)
    expect(controlsVisible.current).toBe(true)
  })

  it('temporarily applies the configured long-press rate and restores it on release', () => {
    const { art, surface } = setup()

    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 50, clientY: 50 })
    vi.advanceTimersByTime(1000)
    expect(art.playbackRate).toBe(3)

    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 50, clientY: 50 })
    expect(art.playbackRate).toBe(1)
  })

  it('cancels long-press playback when the finger moves', () => {
    const { art, surface } = setup()

    fireEvent.pointerDown(surface, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 50,
      clientY: 50
    })
    vi.advanceTimersByTime(1000)
    expect(art.playbackRate).toBe(3)

    fireEvent.pointerMove(surface, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 64,
      clientY: 50
    })
    expect(art.playbackRate).toBe(1)
  })

  it('previews a horizontal swipe without seeking until release and then resumes playback', () => {
    const { art, surface } = setup()

    fireEvent.pointerDown(surface, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 25, clientY: 50 })
    fireEvent.pointerMove(surface, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 75, clientY: 51 })

    expect(art.pause).toHaveBeenCalledOnce()
    expect(art.currentTime).toBe(100)

    fireEvent.pointerUp(surface, { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: 75, clientY: 51 })
    expect(art.currentTime).toBe(150)
    expect(art.play).toHaveBeenCalledOnce()
  })

  it('previews progress dragging and commits only once on mouse release', () => {
    const { art, progress } = setup({ duration: 100, currentTime: 10 })

    fireEvent.mouseDown(progress, { button: 0, clientX: 10 })
    fireEvent.mouseMove(document, { clientX: 50 })
    expect(art.currentTime).toBe(10)

    fireEvent.mouseUp(document, { clientX: 60 })
    expect(art.currentTime).toBe(60)
    expect(art.play).toHaveBeenCalledOnce()
  })

  it('cancels an uncommitted swipe and restores the previous playback state', () => {
    const { art, surface } = setup()

    fireEvent.pointerDown(surface, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 25,
      clientY: 50
    })
    fireEvent.pointerMove(surface, {
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 75,
      clientY: 51
    })
    fireEvent.pointerCancel(surface, { pointerId: 1, pointerType: 'touch', isPrimary: true })

    expect(art.currentTime).toBe(100)
    expect(art.play).toHaveBeenCalledOnce()
  })

  it('uses the configured seek step for focused keyboard navigation', () => {
    const { art } = setup()

    fireEvent.keyDown(document, { key: 'ArrowRight' })
    expect(art.currentTime).toBe(110)
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(art.currentTime).toBe(100)
  })
})
