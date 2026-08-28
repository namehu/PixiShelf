import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnimatedWebpPlayer from '../animated-webp-player'

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

  it('keeps non-animated pending media non-interactive', () => {
    render(<AnimatedWebpPlayer src="/pending.webp" isAnimated={false} />)

    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.getAllByRole('img')).toHaveLength(1)
  })
})
