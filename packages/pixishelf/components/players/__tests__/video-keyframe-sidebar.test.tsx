import { cleanup, fireEvent, render, screen } from '@testing-library/react'
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
  afterEach(() => cleanup())

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
})
