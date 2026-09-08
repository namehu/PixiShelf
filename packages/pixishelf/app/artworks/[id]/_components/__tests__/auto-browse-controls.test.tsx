import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { HTMLAttributes } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useArtworkAutoBrowseStore as store } from '@/store/use-artwork-auto-browse-store'
import { AutoBrowseControls } from '../auto-browse-controls'
import { useAutoBrowseInterruption } from '../use-auto-browse-interruption'

vi.mock('framer-motion', () => ({
  useReducedMotion: () => true,
  motion: {
    div: ({
      layout: _layout,
      transition: _transition,
      ...props
    }: HTMLAttributes<HTMLDivElement> & { layout?: unknown; transition?: unknown }) => {
      void _layout
      void _transition
      return <div {...props} />
    }
  }
}))

function Controls() {
  useAutoBrowseInterruption(1)
  return (
    <AutoBrowseControls mode="scroll" current={12} total={75} onRestart={vi.fn()} onRetry={vi.fn()} onSkip={vi.fn()} />
  )
}

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('auto browse control docking', () => {
  it('docks after four seconds across media changes and expands without interrupting playback', () => {
    render(<Controls />)
    act(() => store.getState().start('scroll'))
    act(() => vi.advanceTimersByTime(2000))
    act(() => {
      store.getState().wait()
      store.getState().setCurrentMedia(13)
      store.getState().ready()
    })
    act(() => vi.advanceTimersByTime(1999))
    expect(screen.getByRole('button', { name: '暂停自动浏览' })).toBeTruthy()
    act(() => vi.advanceTimersByTime(1))
    const dock = screen.getByRole('button', { name: '展开自动浏览控制，当前第 12 张，共 75 张' })
    fireEvent.pointerDown(dock)
    fireEvent.click(dock)
    expect(store.getState().status).toBe('running')
    expect(screen.getByRole('button', { name: '暂停自动浏览' })).toBeTruthy()
  })

  it('automatically reveals controls on manual takeover and on load failure', () => {
    render(<Controls />)
    act(() => store.getState().start('scroll'))
    act(() => vi.advanceTimersByTime(4000))
    fireEvent.wheel(document)
    expect(screen.getByRole('button', { name: '开始或继续自动浏览' })).toBeTruthy()
    act(() => store.getState().resume())
    act(() => vi.advanceTimersByTime(4000))
    act(() => store.getState().pause('error'))
    expect(screen.getByRole('button', { name: '重试' })).toBeTruthy()
    expect(store.getState().controlsCollapsed).toBe(false)
  })

  it('resets the idle delay on interaction and preserves keyboard focus', () => {
    render(<Controls />)
    act(() => store.getState().start('scroll'))
    act(() => vi.advanceTimersByTime(3000))
    const pause = screen.getByRole('button', { name: '暂停自动浏览' })
    fireEvent.pointerMove(pause)
    act(() => vi.advanceTimersByTime(3000))
    expect(store.getState().controlsCollapsed).toBe(false)
    fireEvent.keyDown(document, { key: 'Tab' })
    act(() => pause.focus())
    act(() => vi.advanceTimersByTime(5000))
    expect(document.activeElement).toBe(pause)
    expect(store.getState().controlsCollapsed).toBe(false)
  })

  it('clears a pending collapse when leaving the artwork', () => {
    const { unmount } = render(<Controls />)
    act(() => store.getState().start('scroll'))
    unmount()
    act(() => {
      store.getState().initialize(2)
      store.getState().start('slideshow')
      vi.advanceTimersByTime(5000)
    })
    expect(store.getState().controlsCollapsed).toBe(false)
  })
})
