import { describe, expect, it } from 'vitest'
import { mapBounded } from '../bounded.js'

describe('bounded scan concurrency', () => {
  it('preserves order and never exceeds the configured concurrency', async () => {
    let active = 0
    let maximum = 0
    const result = await mapBounded(
      Array.from({ length: 20 }, (_, index) => index),
      3,
      new AbortController().signal,
      async (value) => {
        active += 1
        maximum = Math.max(maximum, active)
        await Promise.resolve()
        active -= 1
        return value * 2
      }
    )
    expect(maximum).toBe(3)
    expect(result).toEqual(Array.from({ length: 20 }, (_, index) => index * 2))
  })
})
