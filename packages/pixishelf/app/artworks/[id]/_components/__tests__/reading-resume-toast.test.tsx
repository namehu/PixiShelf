import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ReadingResumeToast } from '../reading-resume-toast'

afterEach(() => { cleanup(); vi.useRealTimers() })

it('dismisses after eight seconds without choosing a reading position', () => {
  vi.useFakeTimers()
  const onJump = vi.fn(), onStart = vi.fn(), onDismiss = vi.fn()
  render(<ReadingResumeToast index={236} onJump={onJump} onStart={onStart} onDismiss={onDismiss} />)
  expect(screen.getByText('237')).toBeTruthy()
  act(() => vi.advanceTimersByTime(7999))
  expect(onDismiss).not.toHaveBeenCalled()
  act(() => vi.advanceTimersByTime(1))
  expect(onDismiss).toHaveBeenCalledOnce()
  expect(onJump).not.toHaveBeenCalled()
  expect(onStart).not.toHaveBeenCalled()
})

it('offers explicit jump and start actions and cancels its timer on unmount', () => {
  vi.useFakeTimers()
  const onJump = vi.fn(), onStart = vi.fn(), onDismiss = vi.fn()
  const view = render(<ReadingResumeToast index={5} onJump={onJump} onStart={onStart} onDismiss={onDismiss} />)
  fireEvent.click(screen.getByRole('button', { name: '跳转' }))
  fireEvent.click(screen.getByRole('button', { name: '从头开始' }))
  expect(onJump).toHaveBeenCalledOnce()
  expect(onStart).toHaveBeenCalledOnce()
  view.unmount()
  act(() => vi.advanceTimersByTime(8000))
  expect(onDismiss).not.toHaveBeenCalled()
})
