import React, { useEffect, useRef } from 'react'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnimatedWebpPlayer from '@/components/players/animated-webp-player'
import { webpFixture } from '@/lib/__tests__/webp-fixture'
import { useArtworkAutoBrowseStore as store } from '@/store/use-artwork-auto-browse-store'
import type { ArtworkImageResponseDto } from '@/schemas/artwork.dto'
import { useArtworkAnimation } from '../use-artwork-animation'
import { useArtworkAutoScroll } from '../use-artwork-auto-scroll'
import { useAutoBrowseInterruption } from '../use-auto-browse-interruption'

// The fallback browser path remains covered independently of the default WASM suite.
vi.mock('@/components/players/streaming-webp-surface', () => ({
  default: function UnsupportedSurface({
    onFallback
  }: {
    onFallback: (failure: { code: 'unsupported'; message: string; recoverableByLegacy: true }) => void
  }) {
    useEffect(
      () => onFallback({ code: 'unsupported', message: 'unsupported', recoverableByLegacy: true }),
      [onFallback]
    )
    return null
  }
}))

const media = [
  { id: 1, path: '/animated.webp', mediaType: 'image', isAnimated: true, webpAnimationStatus: 2 }
] as ArtworkImageResponseDto[]
const expand = () => {}
let scrollY = 0
let fetchMock: ReturnType<typeof vi.fn>
let lastPlayback: ReturnType<typeof useArtworkAnimation>

function Reader() {
  const containerRef = useRef<HTMLDivElement>(null)
  useAutoBrowseInterruption(1)
  useArtworkAutoScroll({ containerRef, images: media, expanded: true, expand })
  const playback = useArtworkAnimation(1, 'scroll')
  lastPlayback = playback
  return (
    <div ref={containerRef}>
      <div data-index="0" data-testid="row">
        <div data-preview-status="ready">
          <AnimatedWebpPlayer src="/animated.webp" controlMode="badge" {...playback} />
        </div>
      </div>
    </div>
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  scrollY = 0
  store.getState().initialize(1)
  store.getState().setPreferences({ loop: false, scrollSpeed: 50 })
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
  fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => webpFixture([300, 900]) })
  vi.stubGlobal('fetch', fetchMock)
  let attempt = 0
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:attempt-${++attempt}`)
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
})
afterEach(() => {
  cleanup()
  store.getState().release(store.getState().session)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function start() {
  await act(async () => {
    store.getState().start('scroll')
  })
  await act(async () => vi.advanceTimersByTime(32))
}
function loadAnimation() {
  fireEvent.load(screen.getAllByRole('img')[1]!)
}

describe('real WebP player with scroll driver', () => {
  it.each([false, true])(
    'adopts manual playback and resumes after exactly one loaded loop (StrictMode: %s)',
    async (strict) => {
      render(
        strict ? (
          <React.StrictMode>
            <Reader />
          </React.StrictMode>
        ) : (
          <Reader />
        )
      )
      fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图' }))
      expect(fetchMock).not.toHaveBeenCalled()
      await start()
      expect(fetchMock).toHaveBeenCalledTimes(1)
      act(() => vi.advanceTimersByTime(5000))
      expect(scrollY).toBe(0)
      expect(store.getState().status).toBe('waiting')
      loadAnimation()
      act(() => vi.advanceTimersByTime(1199))
      expect(scrollY).toBe(0)
      act(() => vi.advanceTimersByTime(33))
      expect(scrollY).toBeGreaterThan(0)
      expect(store.getState().completedAnimationIds).toEqual([1])
      expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:attempt-1')
    }
  )

  it('does not classify the animation button as human takeover and keeps scrolling after stop', async () => {
    render(<Reader />)
    await start()
    loadAnimation()
    const pause = screen.getByRole('button', { name: '停止本轮动图' })
    fireEvent.pointerDown(pause)
    fireEvent.click(pause)
    expect(store.getState().status).not.toBe('paused')
    expect(store.getState().stoppedAnimationIds).toEqual([1])
    act(() => vi.advanceTimersByTime(64))
    expect(scrollY).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图' })))
    expect(store.getState().stoppedAnimationIds).toEqual([])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('restarts an interrupted attempt and ignores its old completion callback', async () => {
    render(<Reader />)
    await start()
    loadAnimation()
    const oldComplete = lastPlayback.onAnimationComplete
    act(() => vi.advanceTimersByTime(600))
    act(() => store.getState().pause('overlay'))
    act(() => vi.advanceTimersByTime(5000))
    expect(scrollY).toBe(0)
    await act(async () => store.getState().resume())
    await act(async () => vi.advanceTimersByTime(32))
    act(() => oldComplete())
    expect(store.getState().completedAnimationIds).toEqual([])
    loadAnimation()
    act(() => vi.advanceTimersByTime(1199))
    expect(scrollY).toBe(0)
    act(() => vi.advanceTimersByTime(33))
    expect(scrollY).toBeGreaterThan(0)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('fails closed on a malformed file and allows skip only after explicit resume', async () => {
    fetchMock.mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) })
    render(<Reader />)
    await start()
    expect(store.getState()).toMatchObject({ status: 'paused', reason: 'error', stoppedAnimationIds: [] })
    act(() => store.getState().skip(1))
    act(() => vi.advanceTimersByTime(2000))
    expect(scrollY).toBe(0)
    act(() => store.getState().resume())
    act(() => vi.advanceTimersByTime(64))
    expect(scrollY).toBeGreaterThan(0)
  })
})
