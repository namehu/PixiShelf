import React, { useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEvent } from '../../../../../../pixishelf-webp-player/src/types'
import AnimatedWebpPlayer from '@/components/players/animated-webp-player'
import { useWebpPlayerStore } from '@/store/use-webp-player-store'
import { useArtworkAutoBrowseStore as store, type AutoBrowseMode } from '@/store/use-artwork-auto-browse-store'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { webpFixture } from '@/lib/__tests__/webp-fixture'
import { useArtworkAnimation } from '../use-artwork-animation'
import { useArtworkAutoScroll } from '../use-artwork-auto-scroll'
import { useArtworkSlideshow } from '../use-artwork-slideshow'

// Decode/HTTP are verified by the package's real-browser suite. Only the Worker
// boundary and drawing environment are replaced here; player, clock, React,
// store and both browsing drivers are real.
class Transport {
  static instances: Transport[] = []
  onmessage: ((event: MessageEvent<WorkerEvent>) => void) | null = null
  postMessage = vi.fn()
  terminate = vi.fn()
  constructor() {
    Transport.instances.push(this)
  }
  emit(data: WorkerEvent) {
    this.onmessage?.({ data } as MessageEvent<WorkerEvent>)
  }
}
const media = [
  { id: 1, path: '/a.webp', mediaType: 'image', isAnimated: true, webpAnimationStatus: 2 }
] as ArtworkImageResponseDto[]
const metadata = { format: 'WEBP', durationMs: 1000, frameCount: 1, loopCount: 0, timingPolicyVersion: 1 } as const
const next = vi.fn(),
  first = vi.fn(),
  expand = () => {}
const draw = vi.fn()
let scrollY = 0
let callbacks: ReturnType<typeof useArtworkAnimation>
function Reader({ mode }: { mode: AutoBrowseMode }) {
  const containerRef = useRef<HTMLDivElement>(null)
  useArtworkAutoScroll({ containerRef, images: media, expanded: true, expand })
  useArtworkSlideshow({
    index: 0,
    count: 2,
    ready: true,
    error: false,
    blocked: false,
    transitioning: false,
    mediaId: 1,
    animated: true,
    enabled: mode === 'slideshow',
    onNext: next,
    onFirst: first
  })
  callbacks = useArtworkAnimation(1, mode)
  return (
    <div ref={containerRef}>
      <div data-index="0">
        <div data-preview-status="ready">
          <AnimatedWebpPlayer src="/a.webp" controlMode="badge" animationMetadata={metadata} {...callbacks} />
        </div>
      </div>
    </div>
  )
}
function ExternalReader({ src = '/external.webp' }: { src?: string }) {
  const animation = useArtworkAnimation(1, 'slideshow', src)
  return (
    <div>
      <AnimatedWebpPlayer src={src} controlMode="external" animationMetadata={metadata} {...animation} />
      <button type="button" onClick={() => animation.onPlayingChange(!animation.playing)}>
        切换动图
      </button>
    </div>
  )
}
async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}
async function start(mode: AutoBrowseMode) {
  await act(async () => store.getState().start(mode))
  await advance(32)
  await act(async () => {
    await vi.dynamicImportSettled()
  })
  expect(Transport.instances).toHaveLength(1)
  return Transport.instances[0]!
}
function frame(index: number): WorkerEvent {
  return { type: 'frame', frame: { index, cycleId: 0, durationMs: 1000, width: 1, height: 1, pixels: new ArrayBuffer(4) } }
}
beforeEach(() => {
  useWebpPlayerStore.getState().reset()
  vi.useFakeTimers({
    toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance']
  })
  store.getState().initialize(1)
  store.getState().setPreferences({ loop: false })
  Transport.instances = []
  draw.mockClear()
  next.mockClear()
  first.mockClear()
  scrollY = 0
  vi.stubGlobal('Worker', Transport)
  vi.stubGlobal(
    'ImageData',
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number
      ) {}
    }
  )
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ version: '0123456789abcdef' }),
      arrayBuffer: async () => webpFixture([1000])
    })
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    putImageData: draw
  } as unknown as CanvasRenderingContext2D)
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:legacy')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY)
  vi.spyOn(window, 'scrollTo').mockImplementation((options: number | ScrollToOptions) => {
    if (typeof options === 'object') scrollY = options.top ?? 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    top: -scrollY,
    bottom: 2000 - scrollY,
    height: 2000,
    width: 600,
    left: 0,
    right: 600,
    x: 0,
    y: -scrollY,
    toJSON() {}
  }))
})
afterEach(() => {
  cleanup()
  useWebpPlayerStore.getState().reset()
  store.getState().release(store.getState().session)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
describe.each<AutoBrowseMode>(['scroll', 'slideshow'])('%s streaming integration', (mode) => {
  it('retains one Worker and the remaining frame across pause/settings/resume, then advances once', async () => {
    render(
      <React.StrictMode>
        <Reader mode={mode} />
      </React.StrictMode>
    )
    const worker = await start(mode)
    await act(async () => worker.emit(frame(0)))
    await advance(16)
    expect(draw).toHaveBeenCalledTimes(1)
    const oldComplete = callbacks.onAnimationComplete
    await advance(300)
    act(() => {
      store.getState().pause('overlay')
      store.getState().setPreferences({ slideSeconds: 2 })
    })
    await advance(2000)
    expect(store.getState()).toMatchObject({ status: 'paused', animationPhase: 'paused', activeAnimationId: 1 })
    expect(draw).toHaveBeenCalledTimes(1)
    expect(worker.terminate).not.toHaveBeenCalled()
    act(() => store.getState().resume())
    act(() => oldComplete())
    expect(store.getState().completedAnimationIds).toEqual([])
    await act(async () => {
      worker.emit({ type: 'input', receivedBytes: 100, inputComplete: true })
      worker.emit({ type: 'drained' })
    })
    await advance(640)
    expect(store.getState().completedAnimationIds).toEqual([])
    await advance(100)
    expect(store.getState().completedAnimationIds).toEqual([1])
    await advance(1)
    expect(Transport.instances).toHaveLength(1)
    if (mode === 'slideshow') expect(next).toHaveBeenCalledTimes(1)
    else expect(scrollY).toBeGreaterThan(0)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
  it('releases playback on stop and ignores late completion', async () => {
    const view = render(<Reader mode={mode} />)
    const worker = await start(mode)
    await act(async () => worker.emit(frame(0)))
    await advance(16)
    fireEvent.click(screen.getByRole('button', { name: /停止本轮动图/ }))
    expect(store.getState().stoppedAnimationIds).toEqual([1])
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    act(() => worker.emit({ type: 'drained' }))
    expect(store.getState().completedAnimationIds).toEqual([])
    view.unmount()
  })
  it('falls back once before painting and explains restart semantics', async () => {
    render(<Reader mode={mode} />)
    const worker = await start(mode)
    await act(async () =>
      worker.emit({ type: 'error', error: { code: 'metadata', message: 'metadata', recoverableByLegacy: true } })
    )
    expect(screen.getByRole('status').textContent).toContain('暂停后重播')
    expect(screen.getAllByRole('img').some((image) => image.getAttribute('src') === 'blob:legacy')).toBe(true)
    act(() => store.getState().pause())
    await act(async () => store.getState().resume())
    expect(Transport.instances).toHaveLength(1)
  })
  it('pauses on a network error without marking stopped or complete', async () => {
    render(<Reader mode={mode} />)
    const worker = await start(mode)
    await act(async () =>
      worker.emit({ type: 'error', error: { code: 'network', message: 'network', recoverableByLegacy: false } })
    )
    expect(store.getState()).toMatchObject({
      status: 'paused',
      reason: 'error',
      stoppedAnimationIds: [],
      completedAnimationIds: []
    })
    expect(screen.queryByRole('status')).toBeNull()
  })
})

describe('manual streaming playback', () => {
  it('releases paused playback when the same media ID gets a new source', async () => {
    const view = render(<ExternalReader />)
    fireEvent.click(screen.getByRole('button', { name: '切换动图' }))
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    const worker = Transport.instances[0]!
    await act(async () => worker.emit(frame(0)))
    await advance(16)
    fireEvent.click(screen.getByRole('button', { name: '切换动图' }))
    expect(worker.terminate).not.toHaveBeenCalled()
    view.rerender(<ExternalReader src="/replaced.webp" />)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('canvas')).toBeNull()
    expect(Transport.instances).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: '切换动图' }))
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(Transport.instances).toHaveLength(2)
  })
  it('retains the same Worker for the adaptive external control pause and resume', async () => {
    const view = render(<ExternalReader />)
    fireEvent.click(screen.getByRole('button', { name: '切换动图' }))
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    const worker = Transport.instances[0]!
    await act(async () => worker.emit(frame(0)))
    await advance(200)
    fireEvent.click(screen.getByRole('button', { name: '切换动图' }))
    expect(view.container.querySelector('canvas')).not.toBeNull()
    expect(worker.terminate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '切换动图' }))
    expect(Transport.instances).toHaveLength(1)
    view.unmount()
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })
  it('shares a session manifest through StrictMode, concurrent players and page remounts', async () => {
    let resolve!: (value: Response) => void
    vi.mocked(fetch).mockImplementationOnce(
      () =>
        new Promise<Response>((done) => {
          resolve = done
        })
    )
    const view = render(
      <React.StrictMode>
        <AnimatedWebpPlayer key="first" src="/first.webp" playing />
        <AnimatedWebpPlayer key="second" src="/second.webp" playing />
      </React.StrictMode>
    )
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(fetch).toHaveBeenCalledTimes(1)
    const signal = vi.mocked(fetch).mock.calls[0]![1]!.signal!
    view.rerender(
      <React.StrictMode>
        <AnimatedWebpPlayer key="second" src="/second.webp" playing />
      </React.StrictMode>
    )
    expect(signal.aborted).toBe(false)
    await act(async () => {
      resolve({ ok: true, json: async () => ({ version: '0123456789abcdef' }) } as Response)
      await vi.dynamicImportSettled()
    })
    expect(Transport.instances).toHaveLength(1)
    view.unmount()
    render(<AnimatedWebpPlayer src="/third.webp" playing />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(Transport.instances).toHaveLength(2)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('invalidates cached asset versions when the decoder cannot initialize', async () => {
    render(<AnimatedWebpPlayer src="/manual.webp" playing />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(useWebpPlayerStore.getState().manifest).not.toBeNull()
    act(() =>
      Transport.instances[0]!.emit({
        type: 'error',
        error: { code: 'initialization', message: 'unavailable', recoverableByLegacy: true }
      })
    )
    expect(useWebpPlayerStore.getState().manifest).toBeNull()
    expect(screen.getByRole('status').textContent).toContain('兼容播放：')
  })
  it.each(['surface', 'badge'] as const)(
    'uses WASM from the %s control without automatic browsing',
    async (controlMode) => {
      const view = render(<AnimatedWebpPlayer src="/manual.webp" controlMode={controlMode} animationMetadata={metadata} />)
      fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图' }))
      await act(async () => {
        await vi.dynamicImportSettled()
      })
      const worker = Transport.instances[0]!
      expect(worker.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'start',
          source: expect.objectContaining({ loop: true })
        }),
        []
      )
      await act(async () => worker.emit(frame(0)))
      await advance(16)
      expect(view.container.querySelector('canvas[data-webp-player="wasm"]')?.getAttribute('data-frame-visible')).toBe(
        'true'
      )
      expect(view.container.querySelectorAll('img')).toHaveLength(1)
      expect(draw).toHaveBeenCalledTimes(1)
      expect(store.getState().completedAnimationIds).toEqual([])
      await advance(300)
      const beforePause = view.container.querySelector('[data-animation-progress-fill]')?.getAttribute('style')
      expect(beforePause).toMatch(/width: [0-9]+%/)
      fireEvent.click(screen.getByRole('button', { name: /暂停 WEBP 动图/ }))
      expect(worker.terminate).not.toHaveBeenCalled()
      expect(view.container.querySelector('canvas')).not.toBeNull()
      const pausedProgress = view.container.querySelector('[data-animation-progress-fill]')?.getAttribute('style')
      await advance(2000)
      expect(view.container.querySelector('[data-animation-progress-fill]')?.getAttribute('style')).toBe(pausedProgress)
      expect(draw).toHaveBeenCalledTimes(1)
      fireEvent.click(screen.getByRole('button', { name: /播放 WEBP 动图/ }))
      expect(Transport.instances).toHaveLength(1)
      view.unmount()
      expect(worker.terminate).toHaveBeenCalledTimes(1)
    }
  )

  it('replaces manual looping with a fresh single cycle when automatic browsing takes over', async () => {
    const complete = vi.fn()
    const view = render(
      <AnimatedWebpPlayer src="/manual.webp" controlMode="external" playing onAnimationComplete={complete} />
    )
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    const manual = Transport.instances[0]!
    view.rerender(
      <AnimatedWebpPlayer src="/manual.webp" controlMode="external" playing playOnce onAnimationComplete={complete} />
    )
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(manual.terminate).toHaveBeenCalledTimes(1)
    const automatic = Transport.instances[1]!
    expect(automatic.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'start',
        source: expect.objectContaining({ loop: false })
      }),
      []
    )
    act(() => {
      manual.emit(frame(0))
      manual.emit({ type: 'drained' })
    })
    expect(complete).not.toHaveBeenCalled()
    act(() => {
      automatic.emit(frame(0))
      automatic.emit({ type: 'drained' })
    })
    await advance(1100)
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('keeps a finite final frame at 100% and restarts on the next manual play', async () => {
    const view = render(<AnimatedWebpPlayer src="/finite.webp" controlMode="badge" animationMetadata={metadata} />)
    fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图' }))
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    const worker = Transport.instances[0]!
    await act(async () => {
      worker.emit(frame(0))
      worker.emit({ type: 'drained' })
    })
    await advance(1100)
    expect(screen.getByRole('button', { name: '播放 WEBP 动图，100%' })).toBeTruthy()
    expect(view.container.querySelector('canvas')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图，100%' }))
    expect(Transport.instances).toHaveLength(2)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    view.unmount()
  })

  it('explains manual compatibility fallback before the first frame', async () => {
    const view = render(<AnimatedWebpPlayer src="/manual.webp" playing animationMetadata={metadata} />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    act(() =>
      Transport.instances[0]!.emit({
        type: 'error',
        error: { code: 'metadata', message: 'metadata', recoverableByLegacy: true }
      })
    )
    expect(screen.getByRole('status').textContent).toContain('兼容播放：')
    expect(view.container.querySelector('canvas')).toBeNull()
    expect(view.container.querySelector('[data-animation-progress-fill]')).toBeNull()
    expect(view.container.querySelector('img[src$="/manual.webp"]')).not.toBeNull()
  })

  it.each([
    { name: 'unknown', animationMetadata: null },
    { name: 'old policy', animationMetadata: { ...metadata, timingPolicyVersion: 99 } }
  ])('hides progress for $name duration metadata', async ({ animationMetadata }) => {
    const view = render(<AnimatedWebpPlayer src="/manual.webp" playing animationMetadata={animationMetadata} />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    await act(async () => Transport.instances[0]!.emit(frame(0)))
    await advance(300)
    expect(view.container.querySelector('[data-animation-progress-fill]')).toBeNull()
    expect(store.getState().completedAnimationIds).toEqual([])
  })

  it('releases paused progress offscreen and ignores old A events after A→B→A', async () => {
    let intersection: IntersectionObserverCallback | null = null
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(callback: IntersectionObserverCallback) {
          intersection = callback
        }
        observe() {}
        disconnect() {}
      }
    )
    const view = render(<AnimatedWebpPlayer src="/a.webp" controlMode="badge" animationMetadata={metadata} />)
    fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图' }))
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    const oldA = Transport.instances[0]!
    await act(async () => oldA.emit(frame(0)))
    await advance(300)
    fireEvent.click(screen.getByRole('button', { name: /暂停 WEBP 动图/ }))
    expect(view.container.querySelector('[data-animation-progress-fill]')).not.toBeNull()
    act(() => intersection?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver))
    expect(oldA.terminate).toHaveBeenCalledTimes(1)
    expect(view.container.querySelector('[data-animation-progress-fill]')).toBeNull()

    view.rerender(<AnimatedWebpPlayer src="/b.webp" controlMode="badge" animationMetadata={metadata} playing />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    view.rerender(<AnimatedWebpPlayer src="/a.webp" controlMode="badge" animationMetadata={metadata} playing />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    act(() => oldA.emit(frame(99)))
    expect(view.container.querySelector('[data-animation-progress-fill]')?.getAttribute('style')).toBe('width: 0%;')
    expect(draw).toHaveBeenCalledTimes(1)
  })

  it.each([
    { src: '/manual.gif', isAnimated: true },
    { src: '/static.webp', isAnimated: false }
  ])('keeps unsupported or static media out of WASM: $src', async ({ src, isAnimated }) => {
    const view = render(<AnimatedWebpPlayer src={src} isAnimated={isAnimated} playing />)
    await act(async () => {
      await vi.dynamicImportSettled()
    })
    expect(Transport.instances).toHaveLength(0)
    expect(view.container.querySelector('canvas')).toBeNull()
  })
})
