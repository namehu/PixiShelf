import { renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { useTaskPolling } from '../use-task-polling'

describe('useTaskPolling', () => {
  it('disables polling while SSE is connected', () => {
    const { result } = renderHook(() =>
      useTaskPolling<{ active: boolean }>((data) => Boolean(data?.active), 3_000, {
        liveConnected: true,
        idleInterval: 30_000
      })
    )

    expect(result.current({ state: { data: { active: true } } })).toBe(false)
    expect(result.current({ state: { data: { active: false } } })).toBe(false)
  })

  it('uses three-second active and thirty-second idle fallback intervals after disconnect', () => {
    const { result } = renderHook(() =>
      useTaskPolling<{ active: boolean }>((data) => Boolean(data?.active), 3_000, {
        liveConnected: false,
        idleInterval: 30_000
      })
    )

    expect(result.current({ state: { data: { active: true } } })).toBe(3_000)
    expect(result.current({ state: { data: { active: false } } })).toBe(30_000)
  })
})
