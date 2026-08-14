import { describe, it, expect, vi } from 'vitest'
import { RateLimit } from './rate-limit'

describe('RateLimit', () => {
  it('should limit requests', () => {
    const rateLimit = new RateLimit({ interval: 1000 })
    const token = 'test-ip'

    // 前两次请求应放行。
    expect(rateLimit.check(2, token)).toBe(true)
    expect(rateLimit.check(2, token)).toBe(true)
    
    // 第三次请求应被拦截。
    expect(rateLimit.check(2, token)).toBe(false)
  })

  it('should reset after interval', async () => {
    vi.useFakeTimers()
    const rateLimit = new RateLimit({ interval: 1000 })
    const token = 'test-ip'

    expect(rateLimit.check(1, token)).toBe(true)
    expect(rateLimit.check(1, token)).toBe(false)

    // 时间推进 1001 毫秒，确保越过限流窗口。
    vi.advanceTimersByTime(1001)

    expect(rateLimit.check(1, token)).toBe(true)
    vi.useRealTimers()
  })
})
