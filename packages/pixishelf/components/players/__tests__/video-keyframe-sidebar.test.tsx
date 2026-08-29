import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import VideoKeyframeSidebar from '../video-keyframe-sidebar'
import type { NormalizedVideoKeyframe } from '../video-keyframes'

vi.mock('next/image', () => ({
  default: ({ fill, ...props }: React.ImgHTMLAttributes<HTMLImageElement> & { fill?: boolean }) => {
    void fill
    return <img {...props} />
  }
}))

const keyframes: NormalizedVideoKeyframe[] = [
  { id: 'frame-1', captureTime: 5, selectedOrder: 0, url: '/frame-1.webp' },
  { id: 'frame-2', captureTime: 65, selectedOrder: 1, url: '/frame-2.webp' }
]

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn()
})

describe('VideoKeyframeSidebar', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('renders image-and-time cards without inventing chapter titles', () => {
    const onKeyframeClick = vi.fn()
    render(
      <VideoKeyframeSidebar
        keyframes={keyframes}
        currentKeyframeId="frame-2"
        onKeyframeClick={onKeyframeClick}
        layout="horizontal"
      />
    )

    expect(screen.getByRole('img', { name: '视频画面 01:05' })).toBeDefined()
    const active = screen.getByRole('button', { name: '跳转到画面 01:05' })
    expect(active.getAttribute('aria-current')).toBe('true')
    expect(screen.queryByText(/片段|章节/)).toBeNull()

    fireEvent.click(active)
    expect(onKeyframeClick).toHaveBeenCalledWith(keyframes[1])
  })

  it('keeps the default one-second user-scroll cooldown', () => {
    vi.useFakeTimers()
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    const { container, rerender } = render(
      <VideoKeyframeSidebar
        keyframes={keyframes}
        currentKeyframeId="frame-1"
        onKeyframeClick={vi.fn()}
        layout="horizontal"
      />
    )
    const viewport = container.querySelector<HTMLElement>('[data-keyframe-layout="horizontal"] > div')!
    const secondFrame = screen.getByRole('button', { name: '跳转到画面 01:05' })
    viewport.getBoundingClientRect = () => ({ left: 0, right: 100, top: 0, bottom: 100 }) as DOMRect
    secondFrame.getBoundingClientRect = () => ({ left: 180, right: 280, top: 0, bottom: 100 }) as DOMRect
    scrollIntoView.mockClear()

    fireEvent.wheel(viewport)
    rerender(
      <VideoKeyframeSidebar
        keyframes={keyframes}
        currentKeyframeId="frame-2"
        onKeyframeClick={vi.fn()}
        layout="horizontal"
      />
    )

    act(() => vi.advanceTimersByTime(999))
    expect(scrollIntoView).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  })
})
