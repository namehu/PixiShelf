import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useMediaQuery } from '../use-media-query'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

function mockMedia(initial: boolean) {
  const listeners = new Set<() => void>()
  const media = {
    matches: initial,
    addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
    removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener))
  }
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => media)
  )
  return {
    media,
    listeners,
    resize(matches: boolean) {
      act(() => {
        media.matches = matches
        listeners.forEach((listener) => listener())
      })
    }
  }
}

describe('useMediaQuery', () => {
  it('uses the actual breakpoint on the first render when returning to a cached page', () => {
    mockMedia(true)
    const snapshots: boolean[] = []
    const mount = () => renderHook(() => snapshots.push(useMediaQuery('(min-width: 768px)')))
    const first = mount()
    expect(snapshots).toEqual([true])
    first.unmount()
    snapshots.length = 0
    mount()
    expect(snapshots).toEqual([true])
  })

  it('tracks breakpoint changes and releases its subscription on unmount', () => {
    const { resize, listeners } = mockMedia(false)
    const view = renderHook(() => useMediaQuery('(min-width: 768px)'))
    expect(view.result.current).toBe(false)
    resize(true)
    expect(view.result.current).toBe(true)
    resize(false)
    expect(view.result.current).toBe(false)
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(listeners.size).toBe(0)
  })

  it('replaces the subscription when the query changes', () => {
    const { media, listeners } = mockMedia(true)
    const view = renderHook((query) => useMediaQuery(query), { initialProps: '(min-width: 768px)' })
    view.rerender('(min-width: 1024px)')
    expect(window.matchMedia).toHaveBeenLastCalledWith('(min-width: 1024px)')
    expect(listeners.size).toBe(1)
    view.unmount()
    expect(media.removeEventListener).toHaveBeenCalled()
    expect(listeners.size).toBe(0)
  })

  it('returns the fallback when matchMedia is unavailable', () => {
    vi.stubGlobal('matchMedia', undefined)
    expect(renderHook(() => useMediaQuery('(min-width: 768px)')).result.current).toBe(false)
  })
})
