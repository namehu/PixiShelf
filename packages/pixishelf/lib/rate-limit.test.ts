import { describe, it, expect, vi } from 'vitest'
import { RateLimit } from './rate-limit'

describe('RateLimit', () => {
  it('should limit requests', () => {
    const rateLimit = new RateLimit({ interval: 1000 })
    const token = 'test-ip'

    // Should allow 2 requests
    expect(rateLimit.check(2, token)).toBe(true)
    expect(rateLimit.check(2, token)).toBe(true)
    
    // Should block 3rd request
    expect(rateLimit.check(2, token)).toBe(false)
  })

  it('should reset after interval', async () => {
    vi.useFakeTimers()
    const rateLimit = new RateLimit({ interval: 1000 })
    const token = 'test-ip'

    expect(rateLimit.check(1, token)).toBe(true)
    expect(rateLimit.check(1, token)).toBe(false)

    // Advance time by 1001ms
    vi.advanceTimersByTime(1001)

    expect(rateLimit.check(1, token)).toBe(true)
    vi.useRealTimers()
  })
})
