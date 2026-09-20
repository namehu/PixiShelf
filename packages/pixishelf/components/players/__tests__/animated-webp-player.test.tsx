import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnimatedWebpPlayer from '../animated-webp-player'
import { useLongPress } from '@/hooks/use-long-press'

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

describe('AnimatedWebpPlayer', () => {
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
})
