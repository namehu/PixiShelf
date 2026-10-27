import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LikeButton } from '../like-button/inex'

// jsdom does not implement PointerEvent; preserve pointer coordinates for gesture tests.
class TestPointerEvent extends MouseEvent {
  pointerId = 1
  isPrimary = true
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('PointerEvent', TestPointerEvent)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})
function setup() {
  const toggle = vi.fn()
  const open = vi.fn()
  const view = render(<LikeButton liked={false} onToggleLike={toggle} onOpenRating={open} />)
  return { ...view, button: screen.getByRole('button'), toggle, open }
}

describe('viewer heart gestures', () => {
  it('responds immediately to a short click and a keyboard activation', () => {
    const { button, toggle, open } = setup()
    fireEvent.pointerDown(button, { button: 0, clientX: 20, clientY: 20 })
    act(() => vi.advanceTimersByTime(499))
    fireEvent.pointerUp(button)
    fireEvent.click(button, { detail: 1 })
    expect(toggle).toHaveBeenCalledOnce()
    fireEvent.click(button, { detail: 0 })
    expect(toggle).toHaveBeenCalledTimes(2)
    act(() => vi.advanceTimersByTime(1000))
    expect(open).not.toHaveBeenCalled()
  })
  it('opens after 500ms and consumes the release click, then allows the next click', () => {
    const { button, toggle, open } = setup()
    fireEvent.pointerDown(button, { button: 0 })
    act(() => vi.advanceTimersByTime(500))
    expect(open).toHaveBeenCalledOnce()
    fireEvent.pointerUp(button)
    fireEvent.click(button, { detail: 1 })
    expect(toggle).not.toHaveBeenCalled()
    fireEvent.pointerDown(button, { button: 0 })
    fireEvent.pointerUp(button)
    fireEvent.click(button, { detail: 1 })
    expect(toggle).toHaveBeenCalledOnce()
  })
  it.each(['move', 'cancel', 'blur', 'unmount'] as const)('cancels a pending hold on %s', (reason) => {
    const { button, toggle, open, unmount } = setup()
    fireEvent.pointerDown(button, { button: 0, clientX: 20, clientY: 20 })
    if (reason === 'move') fireEvent.pointerMove(button, { clientX: 31, clientY: 20 })
    if (reason === 'cancel') fireEvent.pointerCancel(button)
    if (reason === 'blur') fireEvent(window, new Event('blur'))
    if (reason === 'unmount') unmount()
    act(() => vi.advanceTimersByTime(1000))
    expect(open).not.toHaveBeenCalled()
    if (reason !== 'unmount') fireEvent.click(button, { detail: 1 })
    expect(toggle).not.toHaveBeenCalled()
  })
  it('keeps the heart mounted while saving and displays the high rating label', () => {
    const { button, rerender, toggle, open } = setup()
    const heart = button.querySelector('svg')
    rerender(<LikeButton liked saving ratingLabel="超爱" onToggleLike={toggle} onOpenRating={open} />)
    expect(screen.getByRole('button').querySelector('svg')).toBe(heart)
    expect(screen.getByText('超爱')).toBeTruthy()
    expect(screen.getByLabelText('正在保存评分')).toBeTruthy()
  })
})
