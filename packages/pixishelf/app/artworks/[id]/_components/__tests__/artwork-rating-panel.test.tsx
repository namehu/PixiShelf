import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ArtworkRatingPanel, type ArtworkRatingPanelProps } from '../artwork-rating-panel'

vi.mock('framer-motion', async (original) => ({
  ...(await original<typeof import('framer-motion')>()),
  useReducedMotion: () => true
}))

const setLevel = vi.fn()
const retry = vi.fn()
function props(extra: Partial<ArtworkRatingPanelProps['rating']> = {}): ArtworkRatingPanelProps {
  return {
    open: true,
    onOpenChange: vi.fn(),
    onReturnFocus: vi.fn(),
    rating: {
      level: null,
      confirmedLevel: null,
      isLoading: false,
      isSaving: false,
      error: null,
      setLevel,
      retry,
      ...extra
    }
  }
}
beforeEach(() => {
  setLevel.mockReset()
  retry.mockReset()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  )
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('bottom artwork rating panel', () => {
  it('opens at the unscored position without saving and focuses the accessible slider', async () => {
    render(<ArtworkRatingPanel {...props()} />)
    const slider = screen.getByRole('slider', { name: '作品评分' })
    expect(slider.getAttribute('aria-valuetext')).toBe('未评分')
    expect(slider.getAttribute('aria-valuenow')).toBe('0')
    await waitFor(() => expect(document.activeElement).toBe(slider))
    expect(setLevel).not.toHaveBeenCalled()
    expect(screen.getByRole('dialog').className).toContain('artwork-rating-panel')
    expect(screen.queryByRole('button', { name: '关闭评分' })).toBeNull()
    expect(screen.queryByText('我的评分')).toBeNull()
    expect(screen.queryByText('拖动或点击选档，松手保存')).toBeNull()
    expect(document.querySelector('.artwork-rating-saved')).toBeNull()
  })

  it('commits all four ratings by keyboard and Home clears the rating', () => {
    render(<ArtworkRatingPanel {...props()} />)
    const slider = screen.getByRole('slider')
    for (let value = 1; value <= 4; value++) {
      fireEvent.keyDown(slider, { key: 'ArrowRight' })
      expect(setLevel).toHaveBeenLastCalledWith(value)
    }
    fireEvent.keyDown(slider, { key: 'Home' })
    expect(setLevel).toHaveBeenLastCalledWith(null)
    expect(screen.getByRole('dialog')).toBeTruthy()
  })

  it('restores the confirmed selection after a cancelled pointer gesture', () => {
    render(<ArtworkRatingPanel {...props({ level: 2, confirmedLevel: 2 })} />)
    const slider = screen.getByRole('slider')
    fireEvent.keyDown(slider, { key: 'End' })
    expect(slider.getAttribute('aria-valuenow')).toBe('4')
    fireEvent.pointerCancel(slider)
    expect(slider.getAttribute('aria-valuenow')).toBe('2')
    expect(setLevel).toHaveBeenCalledTimes(1)
  })

  it('shows failures with a retry action and allows dismissal while saving', () => {
    const input = props({ error: new Error('Offline') })
    const view = render(<ArtworkRatingPanel {...input} />)
    fireEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(retry).toHaveBeenCalledOnce()
    view.rerender(<ArtworkRatingPanel {...input} rating={{ ...input.rating, error: null, isSaving: true }} />)
    expect(screen.getByRole('status').textContent).toContain('保存中')
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Escape' })
    expect(input.onOpenChange).toHaveBeenLastCalledWith(false)
    expect(setLevel).not.toHaveBeenCalled()
  })

  it('acknowledges a completed save inside the thumb without replaying on reopen', () => {
    const input = props({ level: 2, confirmedLevel: 2 })
    const view = render(<ArtworkRatingPanel {...input} />)
    expect(document.querySelector('.artwork-rating-saved')).toBeNull()
    view.rerender(<ArtworkRatingPanel {...input} rating={{ ...input.rating, level: 4, isSaving: true }} />)
    expect(document.querySelector('.artwork-rating-saving')).toBeTruthy()
    view.rerender(<ArtworkRatingPanel {...input} rating={{ ...input.rating, level: 4, confirmedLevel: 4 }} />)
    expect(screen.getByRole('slider').querySelector('.artwork-rating-saved')).toBeTruthy()
    expect(screen.getByRole('status').className).toBe('sr-only')
    view.rerender(<ArtworkRatingPanel {...input} open={false} />)
    view.rerender(<ArtworkRatingPanel {...input} />)
    expect(document.querySelector('.artwork-rating-saved')).toBeNull()
  })

  it('does not replay particles when opening an existing maximum rating or with reduced motion', () => {
    render(<ArtworkRatingPanel {...props({ level: 4, confirmedLevel: 4 })} />)
    expect(document.querySelector('.artwork-rating-particles')).toBeNull()
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'Home' })
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'End' })
    expect(document.querySelector('.artwork-rating-particles')).toBeNull()
  })

  it('closes 200ms after the reduced-motion check and cancels closing on a new gesture', () => {
    vi.useFakeTimers()
    const input = props({ level: 2, confirmedLevel: 2, isSaving: true })
    const view = render(<ArtworkRatingPanel {...input} />)
    view.rerender(<ArtworkRatingPanel {...input} rating={{ ...input.rating, isSaving: false }} />)
    act(() => vi.advanceTimersByTime(199))
    expect(input.onOpenChange).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1))
    expect(input.onOpenChange).toHaveBeenLastCalledWith(false)

    input.onOpenChange = vi.fn()
    view.rerender(<ArtworkRatingPanel {...input} />)
    view.rerender(<ArtworkRatingPanel {...input} rating={{ ...input.rating, isSaving: false }} />)
    fireEvent.keyDown(screen.getByRole('slider'), { key: 'ArrowRight' })
    act(() => vi.advanceTimersByTime(1000))
    expect(input.onOpenChange).not.toHaveBeenCalled()
  })
})
