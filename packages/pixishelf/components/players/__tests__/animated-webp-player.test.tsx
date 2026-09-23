import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnimatedWebpPlayer from '../animated-webp-player'
import { useLongPress } from '@/hooks/use-long-press'
import { webpFixture } from '@/lib/__tests__/webp-fixture'
import { useEffect } from 'react'

// Exercise the legacy path only when the streaming surface reports incompatibility.
vi.mock('../streaming-webp-surface', () => ({
  default: function UnsupportedSurface({ onFallback }: { onFallback: () => void }) {
    useEffect(onFallback, [onFallback])
    return null
  }
}))

let intersectionCallback: IntersectionObserverCallback | null = null

class MockIntersectionObserver {
  constructor(callback: IntersectionObserverCallback) {
    intersectionCallback = callback
  }

  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return []
  }
}

vi.mock('@/utils/combination-static', () => ({
  combinationApiResource: (src: string) => src
}))

describe('AnimatedWebpPlayer compatibility fallback', () => {
  beforeEach(() => {
    intersectionCallback = null
    vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('toggles between the static poster and animated image', () => {
    render(<AnimatedWebpPlayer src="/sample.webp" alt="示例动图" isAnimated />)

    const button = screen.getByRole('button', { name: '播放 WEBP 动图' })
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByRole('img')).toHaveLength(1)

    fireEvent.click(button)

    expect(screen.getByRole('button', { name: '暂停 WEBP 动图' }).getAttribute('aria-pressed')).toBe('true')
    expect(screen.getAllByRole('img')).toHaveLength(2)

    fireEvent.click(button)

    expect(screen.getByRole('button', { name: '播放 WEBP 动图' }).getAttribute('aria-pressed')).toBe('false')
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('automatically pauses when it leaves the viewport', () => {
    render(<AnimatedWebpPlayer src="/sample.webp" isAnimated />)
    fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图' }))

    act(() => {
      intersectionCallback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver)
    })

    expect(screen.getByRole('button', { name: '播放 WEBP 动图' })).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('automatically pauses when the document becomes hidden', () => {
    render(<AnimatedWebpPlayer src="/sample.webp" isAnimated />)
    fireEvent.click(screen.getByRole('button', { name: '播放 WEBP 动图' }))
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)

    act(() => document.dispatchEvent(new Event('visibilitychange')))

    expect(screen.getByRole('button', { name: '播放 WEBP 动图' })).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('uses only the badge as the playback control without bubbling preview gestures', () => {
    const parentMouseDown = vi.fn()
    const parentMouseUp = vi.fn()
    const parentClick = vi.fn()

    render(
      <div onMouseDown={parentMouseDown} onMouseUp={parentMouseUp} onClick={parentClick}>
        <AnimatedWebpPlayer src="/sample.webp" isAnimated controlMode="badge" />
      </div>
    )

    const badge = screen.getByRole('button', { name: '播放 WEBP 动图' })
    fireEvent.mouseDown(badge)
    fireEvent.mouseUp(badge)
    fireEvent.click(badge)

    expect(parentMouseDown).not.toHaveBeenCalled()
    expect(parentMouseUp).not.toHaveBeenCalled()
    expect(parentClick).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: '暂停 WEBP 动图' })).toBeTruthy()
    expect(screen.getAllByRole('img')).toHaveLength(2)
  })

  it.each(['mouseleave', 'preview', 'scroll', 'longpress'])('keeps the badge usable after a %s gesture', (gesture) => {
    vi.useFakeTimers()
    const onPreview = vi.fn()
    const onLongPress = vi.fn()
    function PreviewSurface() {
      const handlers = useLongPress({ onClick: onPreview, onLongPress })
      return (
        <div {...handlers} data-testid="preview-surface">
          <AnimatedWebpPlayer src="/sample.webp" isAnimated controlMode="badge" />
        </div>
      )
    }
    render(<PreviewSurface />)
    const surface = screen.getByTestId('preview-surface')
    if (gesture === 'mouseleave') fireEvent.mouseLeave(surface)
    if (gesture === 'preview') {
      fireEvent.mouseDown(surface)
      fireEvent.mouseUp(surface)
      fireEvent.click(surface)
    }
    if (gesture === 'scroll' || gesture === 'longpress') {
      fireEvent.touchStart(surface, { touches: [{ clientX: 20, clientY: 30 }] })
      if (gesture === 'scroll') fireEvent.touchMove(surface, { touches: [{ clientX: 20, clientY: 60 }] })
      else act(() => vi.advanceTimersByTime(500))
      fireEvent.touchEnd(surface, { touches: [] })
      fireEvent.click(surface)
    }
    onPreview.mockClear()
    onLongPress.mockClear()

    const badge = screen.getByRole('button', { name: '播放 WEBP 动图' })
    fireEvent.touchStart(badge, { touches: [{ clientX: 20, clientY: 30 }] })
    fireEvent.touchEnd(badge, { touches: [] })
    fireEvent.mouseDown(badge)
    fireEvent.mouseUp(badge)
    fireEvent.click(badge)
    expect(screen.getByRole('button', { name: '暂停 WEBP 动图' }).getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(badge)
    expect(screen.getByRole('button', { name: '播放 WEBP 动图' }).getAttribute('aria-pressed')).toBe('false')
    act(() => vi.advanceTimersByTime(600))
    expect(onPreview).not.toHaveBeenCalled()
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it('supports externally controlled playback without rendering an internal badge', () => {
    const onPlayingChange = vi.fn()
    const { rerender } = render(
      <AnimatedWebpPlayer
        src="/sample.webp"
        isAnimated
        controlMode="external"
        playing={false}
        onPlayingChange={onPlayingChange}
      />
    )

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText('WEBP')).toBeNull()
    expect(screen.getAllByRole('img')).toHaveLength(1)

    rerender(
      <AnimatedWebpPlayer
        src="/sample.webp"
        isAnimated
        controlMode="external"
        playing
        onPlayingChange={onPlayingChange}
      />
    )
    expect(screen.getAllByRole('img')).toHaveLength(2)

    fireEvent.error(screen.getAllByRole('img')[1]!)
    expect(onPlayingChange).toHaveBeenCalledWith(false)
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('keeps non-animated pending media non-interactive', () => {
    render(<AnimatedWebpPlayer src="/pending.webp" isAnimated={false} />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('loads a single-loop copy on demand and exposes its duration only after image loading', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => webpFixture([300, 900]) })
    vi.stubGlobal('fetch', fetchMock)
    const create = vi.fn(() => 'blob:single-loop')
    const revoke = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
    const { container, rerender } = render(
      <AnimatedWebpPlayer src="/sample.webp" controlMode="badge" playing={false} playOnce />
    )
    expect(fetchMock).not.toHaveBeenCalled()
    await act(async () => {
      rerender(<AnimatedWebpPlayer src="/sample.webp" controlMode="badge" playing playOnce />)
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(container.firstElementChild?.getAttribute('data-animation-status')).toBe('loading')
    expect(screen.getAllByRole('img')[1]?.getAttribute('src')).toBe('blob:single-loop')
    fireEvent.load(screen.getAllByRole('img')[1]!)
    expect(container.firstElementChild?.getAttribute('data-animation-status')).toBe('ready')
    expect(container.firstElementChild?.getAttribute('data-animation-duration-ms')).toBe('1200')
    rerender(<AnimatedWebpPlayer src="/sample.webp" controlMode="badge" playing={false} playOnce />)
    expect(revoke).toHaveBeenCalledWith('blob:single-loop')
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('does not restart single-loop requests or their clock when callbacks change', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => webpFixture([1200]) })
    vi.stubGlobal('fetch', fetchMock)
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:stable-attempt')
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const complete = vi.fn()
    const { rerender } = render(
      <AnimatedWebpPlayer
        src="/sample.webp"
        playing
        playOnce
        onAnimationComplete={complete}
        onPlayingChange={() => {}}
        onAnimationError={() => {}}
      />
    )
    await act(async () => {})
    fireEvent.load(screen.getAllByRole('img')[1]!)
    act(() => vi.advanceTimersByTime(600))
    rerender(
      <AnimatedWebpPlayer
        src="/sample.webp"
        playing
        playOnce
        onAnimationComplete={() => complete()}
        onPlayingChange={() => {}}
        onAnimationError={() => {}}
      />
    )
    act(() => vi.advanceTimersByTime(600))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(complete).toHaveBeenCalledTimes(1)
    fireEvent.load(screen.getAllByRole('img')[1]!)
    act(() => vi.advanceTimersByTime(5000))
    expect(complete).toHaveBeenCalledTimes(1)
  })

  it('cancels an in-flight copy and ignores its late result after playback stops', async () => {
    let resolve!: (response: unknown) => void
    const fetchMock = vi.fn(
      () =>
        new Promise((done) => {
          resolve = done
        })
    )
    vi.stubGlobal('fetch', fetchMock)
    const create = vi.fn()
    vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() })
    const { rerender } = render(<AnimatedWebpPlayer src="/sample.webp" playing playOnce />)
    const signal = (fetchMock.mock.calls[0] as unknown as [string, { signal: AbortSignal }])[1].signal
    rerender(<AnimatedWebpPlayer src="/sample.webp" playing={false} playOnce />)
    expect(signal.aborted).toBe(true)
    await act(async () => resolve({ ok: true, arrayBuffer: async () => webpFixture([100]) }))
    expect(create).not.toHaveBeenCalled()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })

  it('reports malformed animation data without falling back to unlimited playback', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new ArrayBuffer(0) }))
    const onAnimationError = vi.fn()
    const onPlayingChange = vi.fn()
    await act(async () => {
      render(
        <AnimatedWebpPlayer
          src="/sample.webp"
          playing
          playOnce
          onAnimationError={onAnimationError}
          onPlayingChange={onPlayingChange}
        />
      )
    })
    expect(onAnimationError).toHaveBeenCalledTimes(1)
    expect(onPlayingChange).toHaveBeenCalledWith(false)
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })
})
