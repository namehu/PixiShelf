import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type Artplayer from 'artplayer'
import { useManagedVideoPlayback } from '../use-managed-video-playback'

afterEach(cleanup)

function player() {
  return { play: vi.fn().mockResolvedValue(undefined), pause: vi.fn(), muted: false, currentTime: 12 }
}

describe('managed detail video playback', () => {
  it('falls back to muted playback only for policy rejection', async () => {
    const art = player()
    art.play.mockRejectedValueOnce(new DOMException('blocked', 'NotAllowedError'))
    renderHook(() => useManagedVideoPlayback(art as unknown as Artplayer, true, false, false))
    await waitFor(() => expect(art.play).toHaveBeenCalledTimes(2))
    expect(art.muted).toBe(true)
  })

  it('does not retry resource failures or an already-muted policy failure', async () => {
    const art = player()
    art.play.mockRejectedValue(new DOMException('unsupported', 'NotSupportedError'))
    renderHook(() => useManagedVideoPlayback(art as unknown as Artplayer, true, false, false))
    await act(async () => {})
    expect(art.play).toHaveBeenCalledTimes(1)
  })

  it('pauses offscreen without losing position and respects a manual pause on re-entry', async () => {
    const art = player()
    const intent = vi.fn()
    const view = renderHook(
      ({ active, paused }) => useManagedVideoPlayback(art as unknown as Artplayer, active, paused, false, intent),
      { initialProps: { active: true, paused: false } }
    )
    await act(async () => {})
    act(() => view.result.current.onPause())
    expect(intent).toHaveBeenCalledWith(false)
    view.rerender({ active: false, paused: true })
    view.rerender({ active: true, paused: true })
    expect(art.pause).toHaveBeenCalled()
    expect(art.play).toHaveBeenCalledTimes(1)
    expect(art.currentTime).toBe(12)
  })

  it('does not report automatic pause as user intent and cancels a stale muted retry', async () => {
    const art = player()
    let reject!: (error: Error) => void
    art.play.mockImplementation(
      () =>
        new Promise<void>((_, fail) => {
          reject = fail
        })
    )
    const intent = vi.fn()
    const view = renderHook(
      ({ active }) => useManagedVideoPlayback(art as unknown as Artplayer, active, false, false, intent),
      { initialProps: { active: true } }
    )
    art.pause.mockImplementation(() => view.result.current.onPause())
    view.rerender({ active: false })
    await act(async () => reject(new DOMException('blocked', 'NotAllowedError')))
    expect(art.play).toHaveBeenCalledTimes(1)
    expect(intent).not.toHaveBeenCalled()
  })

  it('leaves unmanaged players alone', () => {
    const art = player()
    renderHook(() => useManagedVideoPlayback(art as unknown as Artplayer, undefined, false, false))
    expect(art.play).not.toHaveBeenCalled()
    expect(art.pause).not.toHaveBeenCalled()
  })

  it('rejects late success from an old instance, after failure and after unmount', async () => {
    const old = player()
    const next = player()
    const intent = vi.fn()
    const view = renderHook(
      ({ art, failed }) => useManagedVideoPlayback(art as unknown as Artplayer, true, false, failed, intent),
      { initialProps: { art: old, failed: false } }
    )
    await act(async () => {})
    view.rerender({ art: next, failed: false })
    expect(view.result.current.onPlay(old as unknown as Artplayer).allowed).toBe(false)
    view.rerender({ art: next, failed: true })
    expect(view.result.current.onPlay(next as unknown as Artplayer).allowed).toBe(false)
    view.unmount()
    expect(view.result.current.onPlay(next as unknown as Artplayer).allowed).toBe(false)
    expect(intent).not.toHaveBeenCalled()
  })
})
