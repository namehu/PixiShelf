import { act, renderHook } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { getVideoKeyframeRetryCountdown, type VideoKeyframeJobView } from '@/types/video-keyframe'
import { useVideoKeyframeRetryClock } from '../use-video-keyframe-retry-clock'

describe('useVideoKeyframeRetryClock', () => {
  afterEach(() => vi.useRealTimers())

  it('advances a countdown even when the job object does not change', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-13T08:00:00.000Z')
    const job: VideoKeyframeJobView = {
      id: 'job-1',
      status: 'PENDING',
      progress: 92,
      availableAt: '2026-08-13T08:00:05.000Z'
    }
    const { result } = renderHook(() => useVideoKeyframeRetryClock([job]))

    expect(getVideoKeyframeRetryCountdown(job, result.current)).toBe('5 秒后自动重试')
    act(() => vi.advanceTimersByTime(2_000))
    expect(getVideoKeyframeRetryCountdown(job, result.current)).toBe('3 秒后自动重试')
  })

  it('keeps ticking for a future retry when another pending deadline has already passed', () => {
    vi.useFakeTimers()
    vi.setSystemTime('2026-08-13T08:00:00.000Z')
    const expired: VideoKeyframeJobView = {
      id: 'expired',
      status: 'PENDING',
      progress: 92,
      availableAt: '2026-08-13T07:59:59.000Z'
    }
    const future: VideoKeyframeJobView = {
      id: 'future',
      status: 'PENDING',
      progress: 92,
      availableAt: '2026-08-13T08:00:05.000Z'
    }
    const { result } = renderHook(() => useVideoKeyframeRetryClock([expired, future]))

    expect(getVideoKeyframeRetryCountdown(future, result.current)).toBe('5 秒后自动重试')
    act(() => vi.advanceTimersByTime(2_000))
    expect(getVideoKeyframeRetryCountdown(future, result.current)).toBe('3 秒后自动重试')
  })
})
