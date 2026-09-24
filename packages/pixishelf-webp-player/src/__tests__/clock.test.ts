import { describe, expect, it } from 'vitest'
import { FrameClock } from '../clock'
describe('FrameClock', () => {
  it('preserves remaining display time across pauses, without counting the pause', () => {
    const clock = new FrameClock()
    clock.start(1000, 100)
    expect(clock.peekRemaining(400)).toBe(700)
    clock.pause(400)
    expect(clock.remainingMs).toBe(700)
    expect(clock.peekRemaining(1400)).toBe(700)
    clock.resume(2400)
    expect(clock.advance(2600)).toBe(500)
    expect(clock.advance(3100)).toBe(0)
  })
  it('does not allow negative durations after long frames or clock reversal', () => {
    const clock = new FrameClock()
    clock.start(20, 10)
    expect(clock.advance(5)).toBe(20)
    expect(clock.advance(2000)).toBe(0)
    clock.reset()
    expect(clock.remainingMs).toBe(0)
  })
})
