import React from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ApngPlayer from '../apng-player'

vi.mock('next/image', () => ({
  default: ({ alt, sizes }: { alt: string; sizes: string }) => <img alt={alt} sizes={sizes} />
}))

vi.mock('@/utils/combination-static', () => ({
  combinationApiResource: (src: string) => src
}))

afterEach(cleanup)

describe('ApngPlayer semantics', () => {
  it('keeps the default poster sizing and accepts a reading-column override', () => {
    const { rerender } = render(<ApngPlayer src="/sample.png" alt="poster" />)
    expect(screen.getByRole('img').getAttribute('sizes')).toBe('100vw')
    rerender(<ApngPlayer src="/sample.png" alt="poster" posterSizes="(max-width: 45rem) 100vw, 45rem" />)
    expect(screen.getByRole('img').getAttribute('sizes')).toBe('(max-width: 45rem) 100vw, 45rem')
  })

  it('uses a native labelled button for playback', () => {
    render(<ApngPlayer src="/sample.png" alt="示例动画" />)

    const button = screen.getByRole('button', { name: '播放或暂停动画：示例动画' })
    expect(button.getAttribute('type')).toBe('button')
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(screen.getByRole('img', { name: '示例动画' })).toBeTruthy()
  })

  it('keeps badge playback independent from the poster without nesting buttons', () => {
    const playing = vi.fn()
    const { container } = render(<ApngPlayer src="/sample.png" alt="示例动画" controlMode="badge" onPlayingChange={playing} />)
    fireEvent.click(screen.getByRole('img'))
    expect(playing).not.toHaveBeenCalled()
    expect(container.querySelector('button button')).toBeNull()
    const button = screen.getByRole('button', { name: '播放或暂停动画：示例动画' })
    expect(button.hasAttribute('data-long-press-ignore')).toBe(true)
    expect(button.className).toContain('min-h-11')
    expect(button.className).toContain('right-2')
  })
})
