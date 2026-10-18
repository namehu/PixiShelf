import { act, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useVideoReading } from '../use-video-reading'

afterEach(() => vi.restoreAllMocks())

it('publishes start and 90% transitions, latches completion across looping and resets for another media/account', () => {
  const { result, rerender } = renderHook(({ id }) => useVideoReading(id, true), { initialProps: { id: 'alice:1' } })
  const tick = (currentTime: number, started = true) => act(() => result.current.onProgress({
    currentTime, duration: 100, started, playing: started
  }))
  tick(0, false)
  expect(result.current.playback).toBeNull()
  tick(1)
  const first = result.current.playback
  tick(89.9)
  expect(result.current.playback).toBe(first)
  tick(90)
  expect(result.current.playback?.currentTime).toBe(90)
  tick(0)
  expect(result.current.playback?.currentTime).toBe(90)
  rerender({ id: 'bob:1' })
  expect(result.current.playback).toBeNull()
})

it('ignores offscreen, background and offline progress and accepts fresh foreground evidence', () => {
  const { result, rerender } = renderHook(({ enabled }) => useVideoReading('1', enabled), { initialProps: { enabled: false } })
  const tick = () => act(() => result.current.onProgress({ currentTime: 95, duration: 100, started: true, playing: true }))
  tick()
  expect(result.current.playback).toBeNull()
  rerender({ enabled: true })
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  tick()
  expect(result.current.playback).toBeNull()
  hidden.mockReturnValue(false)
  const online = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  tick()
  expect(result.current.playback).toBeNull()
  online.mockReturnValue(true)
  tick()
  expect(result.current.playback?.currentTime).toBe(95)
})

it('does not complete with unknown or invalid duration and reports pause without losing progress', () => {
  const { result } = renderHook(() => useVideoReading('1', true))
  act(() => result.current.onProgress({ currentTime: 10, duration: Infinity, started: true, playing: true }))
  expect(result.current.playback?.duration).toBe(0)
  act(() => result.current.onProgress({ currentTime: 90, duration: 100, started: true, playing: false }))
  expect(result.current.playback).toMatchObject({ currentTime: 90, duration: 100, playing: false })
})
