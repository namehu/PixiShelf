import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useDetailMediaGestures } from '../use-detail-media-gestures'

const like = vi.fn()
const menu = vi.fn()
let cancel: () => void
function Surface({ id = 1 }: { id?: number }) {
  const gesture = useDetailMediaGestures({ mediaId: id, onLike: like, onMenu: menu })
  cancel = gesture.cancel
  return (
    <div data-testid="surface" tabIndex={0} {...gesture.surfaceProps}>
      <button>播放</button>
    </div>
  )
}
function tap(target: HTMLElement, x = 50, y = 60) {
  fireEvent.mouseDown(target, { clientX: x, clientY: y })
  fireEvent.mouseUp(target, { clientX: x, clientY: y })
  fireEvent.click(target)
}
function touchTap(target: HTMLElement, x = 50, y = 60) {
  fireEvent.touchStart(target, { touches: [{ clientX: x, clientY: y }] })
  fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: x, clientY: y }] })
}
beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('detail surface gesture recognition', () => {
  it('leaves one tap inactive and pairs two taps at the 300ms and 40px boundaries', () => {
    render(<Surface />)
    const target = screen.getByTestId('surface')
    tap(target)
    expect(like).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(300))
    tap(target, 90)
    expect(like).toHaveBeenCalledExactlyOnceWith({ x: 90, y: 60 })
    expect(menu).not.toHaveBeenCalled()
  })
  it.each(['time', 'distance'])('rejects a pair outside the %s boundary', (boundary) => {
    render(<Surface />)
    const target = screen.getByTestId('surface')
    tap(target)
    if (boundary === 'time') act(() => vi.advanceTimersByTime(301))
    tap(target, boundary === 'distance' ? 91 : 50)
    expect(like).not.toHaveBeenCalled()
  })
  it('ignores compatibility mouse events after touch and allows repeated real pairs', () => {
    render(<Surface />)
    const target = screen.getByTestId('surface')
    touchTap(target)
    tap(target)
    expect(like).not.toHaveBeenCalled()
    touchTap(target)
    tap(target)
    expect(like).toHaveBeenCalledTimes(1)
    touchTap(target)
    touchTap(target)
    expect(like).toHaveBeenCalledTimes(2)
  })
  it.each(['move', 'diagonal', 'long', 'multi', 'cancel', 'external'])('clears the pending pair after %s', (kind) => {
    render(<Surface />)
    const target = screen.getByTestId('surface')
    touchTap(target)
    fireEvent.touchStart(target, { touches: [{ clientX: 50, clientY: 60 }] })
    if (kind === 'move') fireEvent.touchMove(target, { touches: [{ clientX: 50, clientY: 71 }] })
    if (kind === 'diagonal') fireEvent.touchMove(target, { touches: [{ clientX: 58, clientY: 68 }] })
    if (kind === 'long') act(() => vi.advanceTimersByTime(500))
      if (kind === 'multi') {
      fireEvent.touchStart(target, {
        touches: [
          { clientX: 50, clientY: 60 },
          { clientX: 70, clientY: 70 }
        ]
      })
      }
    if (kind === 'cancel') fireEvent.touchCancel(target)
    if (kind === 'external') act(() => cancel())
    fireEvent.touchEnd(target, { touches: [], changedTouches: [{ clientX: 50, clientY: 60 }] })
    touchTap(target)
    expect(like).not.toHaveBeenCalled()
    expect(menu).toHaveBeenCalledTimes(kind === 'long' ? 1 : 0)
  })
  it('does not pair across media changes and cleans up long press on unmount', () => {
    const view = render(<Surface />)
    const target = screen.getByTestId('surface')
    tap(target)
    view.rerender(<Surface id={2} />)
    tap(target)
    expect(like).not.toHaveBeenCalled()
    fireEvent.mouseDown(target)
    view.unmount()
    act(() => vi.advanceTimersByTime(600))
    expect(menu).not.toHaveBeenCalled()
  })
  it('keeps internal controls independent and opens the surface menu with keyboard or right click', () => {
    render(<Surface />)
    const target = screen.getByTestId('surface')
    const button = screen.getByRole('button')
    tap(button)
    tap(button)
    fireEvent.keyDown(button, { key: 'Enter' })
    fireEvent.contextMenu(button)
    expect(like).not.toHaveBeenCalled()
    expect(menu).not.toHaveBeenCalled()
    fireEvent.keyDown(target, { key: 'Enter' })
    fireEvent.keyDown(target, { key: ' ' })
    fireEvent.contextMenu(target)
    expect(menu).toHaveBeenCalledTimes(3)
  })

  it('ends the pending tap pair when an independent player control stops bubbling', () => {
    render(<Surface />)
    const target = screen.getByTestId('surface')
    const button = screen.getByRole('button')
    button.addEventListener('pointerdown', (event) => event.stopPropagation())
    tap(target)
    fireEvent.pointerDown(button)
    tap(button)
    tap(target)
    expect(like).not.toHaveBeenCalled()
  })
})
