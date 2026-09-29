import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLongPress } from '../use-long-press'

const onLongPress = vi.fn()
const onClick = vi.fn()
const onSurfaceClick = vi.fn()
function Surface() {
  const handlers = useLongPress({ onLongPress, onClick })
  return <div {...handlers} data-testid="surface"><button onClick={onSurfaceClick}>Media</button></div>
}
const touches = [{ clientX: 20, clientY: 30 }]
function compatibilityClick(target: HTMLElement) {
  fireEvent.mouseDown(target)
  fireEvent.mouseUp(target)
  fireEvent.click(target)
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('useLongPress touch gestures', () => {
  it('opens once and suppresses release clicks even after a long hold', () => {
    render(<Surface />)
    const target = screen.getByRole('button')
    fireEvent.touchStart(target, { touches })
    act(() => vi.advanceTimersByTime(2000))
    fireEvent.touchEnd(target, { touches: [] })
    compatibilityClick(target)
    expect(onLongPress).toHaveBeenCalledTimes(1)
    expect(onClick).not.toHaveBeenCalled()
    expect(onSurfaceClick).not.toHaveBeenCalled()
  })

  it('handles a tap once despite compatibility mouse events', () => {
    render(<Surface />)
    const target = screen.getByRole('button')
    fireEvent.touchStart(target, { touches })
    fireEvent.touchEnd(target, { touches: [] })
    compatibilityClick(target)
    act(() => vi.advanceTimersByTime(600))
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onLongPress).not.toHaveBeenCalled()
  })

  it.each(['move', 'cancel', 'multitouch'])('cancels %s without a preview or leaked timer', (action) => {
    render(<Surface />)
    const target = screen.getByRole('button')
    fireEvent.touchStart(target, { touches })
    if (action === 'move') fireEvent.touchMove(target, { touches: [{ clientX: 20, clientY: 60 }] })
    if (action === 'cancel') fireEvent.touchCancel(target, { touches: [] })
    if (action === 'multitouch') fireEvent.touchStart(target, { touches: [...touches, { clientX: 80, clientY: 30 }] })
    fireEvent.touchEnd(target, { touches: [] })
    compatibilityClick(target)
    act(() => vi.advanceTimersByTime(600))
    expect(onLongPress).not.toHaveBeenCalled()
    expect(onClick).not.toHaveBeenCalled()
    expect(onSurfaceClick).not.toHaveBeenCalled()
  })

  it('prevents the native context menu without cancelling the custom long press', () => {
    render(<Surface />)
    const target = screen.getByRole('button')
    fireEvent.touchStart(target, { touches })
    expect(fireEvent.contextMenu(target)).toBe(false)
    act(() => vi.advanceTimersByTime(500))
    expect(onLongPress).toHaveBeenCalledTimes(1)
  })

  it('cleans up a pending long press on unmount', () => {
    const { unmount } = render(<Surface />)
    fireEvent.touchStart(screen.getByRole('button'), { touches })
    unmount()
    act(() => vi.advanceTimersByTime(500))
    expect(onLongPress).not.toHaveBeenCalled()
  })
})
