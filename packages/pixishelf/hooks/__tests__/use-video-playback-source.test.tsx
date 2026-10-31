import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useVideoPlaybackSource } from '../use-video-playback-source'
const source = (id = 1) => ({
  status: 'READY',
  originalUrl: `/api/v1/media/${id}/playback?original=${'a'.repeat(24)}`,
  playbackUrl: `/api/v1/media/${id}/playback?generation=11111111-1111-4111-8111-111111111111`
})
afterEach(() => vi.unstubAllGlobals())
const video = () =>
  ({
    currentTime: 37,
    duration: 100,
    paused: true,
    volume: 0.4,
    muted: true,
    playbackRate: 1.5,
    play: vi.fn().mockResolvedValue(undefined),
    pause: vi.fn()
  }) as unknown as HTMLVideoElement

describe('video source selection', () => {
  it('waits for resolution, defaults to copy, and preserves paused playback state when switching', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(source())))
    const { result } = renderHook(() => useVideoPlaybackSource(1, 'original.mp4'))
    expect(result.current.src).toBeUndefined()
    await waitFor(() => expect(result.current.usingPlayback).toBe(true))
    const before = video()
    act(() => result.current.switchSource(before))
    expect(result.current.src).toBe(source().originalUrl)
    const after = video()
    after.currentTime = 0
    after.volume = 1
    after.muted = false
    after.playbackRate = 1
    act(() => result.current.restore(after))
    expect(after).toMatchObject({ currentTime: 37, volume: 0.4, muted: true, playbackRate: 1.5 })
    expect(after.pause).toHaveBeenCalled()
    expect(after.play).not.toHaveBeenCalled()
  })
  it('refreshes the source before fallback and restores a playing video', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json(source()))
      .mockResolvedValueOnce(
        Response.json({
          ...source(),
          playbackUrl: null,
          originalUrl: `/api/v1/media/1/playback?original=${'b'.repeat(24)}`
        })
      )
    vi.stubGlobal('fetch', fetch)
    const { result } = renderHook(() => useVideoPlaybackSource(1, 'original.mp4'))
    await waitFor(() => expect(result.current.usingPlayback).toBe(true))
    act(() => {
      expect(result.current.handleError(video(), true)).toBe(true)
      expect(result.current.handleError(video(), true)).toBe(true)
    })
    expect(fetch).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(result.current.src).toContain('bbbb'))
    const after = video()
    act(() => result.current.restore(after))
    expect(after.play).toHaveBeenCalledOnce()
    expect(result.current.handleError(after)).toBe(false)
  })
  it('does not load a fallback during a source write', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ status: 'WRITING', originalUrl: null, playbackUrl: null }))
    )
    const { result } = renderHook(() => useVideoPlaybackSource(1, 'original.mp4'))
    await waitFor(() => expect(result.current.error).toContain('修改'))
    expect(result.current.src).toBeUndefined()
  })
  it('does not fetch offscreen media and resets preference for a different video', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json(source(url.includes('/2/') ? 2 : 1))))
    )
    const { result, rerender } = renderHook(({ id, enabled }) => useVideoPlaybackSource(id, 'original.mp4', enabled), {
      initialProps: { id: 1, enabled: false }
    })
    expect(fetch).not.toHaveBeenCalled()
    rerender({ id: 1, enabled: true })
    await waitFor(() => expect(result.current.usingPlayback).toBe(true))
    act(() => result.current.switchSource(video()))
    rerender({ id: 2, enabled: true })
    await waitFor(() => expect(result.current.src).toBe(source(2).playbackUrl))
  })
})
