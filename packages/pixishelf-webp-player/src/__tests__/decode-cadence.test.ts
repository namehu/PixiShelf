import { describe, expect, it } from 'vitest'
import { DecodeCadence } from '../decode-cadence'
import { PlaybackPressure } from '../playback-pressure'
import type { EncodedFrame } from '../independent-frame'
const frames = (count = 304): EncodedFrame[] =>
  Array.from({ length: count }, (_, index) => ({
    index,
    cycleId: 0,
    cycleStartMs: 0,
    width: 1,
    height: 1,
    encoded: new ArrayBuffer(0),
    startMs: Math.round((index * 1000) / 60),
    endMs: Math.round(((index + 1) * 1000) / 60),
    durationMs: Math.round(((index + 1) * 1000) / 60) - Math.round((index * 1000) / 60)
  }))
describe('sustainable decoding', () => {
  it('aligns each transition without changing source timestamps or final frame', () => {
    for (let after = 0; after <= 32; after++) {
      const cadence = new DecodeCadence(),
        source = frames(),
        selected: EncodedFrame[] = []
      for (let i = 0; i < source.length; i++) {
        const f = source[i]!
        cadence.observeFrame(f.durationMs)
        if (selected.length >= after) cadence.enable()
        if (cadence.skip(f, source[i + 1])) continue
        cadence.dispatched(f, i === source.length - 1)
        selected.push(f)
      }
      expect(selected[0]!.index).toBe(0)
      expect(selected.at(-1)!.index).toBe(303)
      const steady = selected.filter((f) => f.startMs >= 1000).slice(0, -1)
      for (let i = 1; i < steady.length; i++)
        expect(steady[i]!.presentationMs! - steady[i - 1]!.presentationMs!).toBeCloseTo(1000 / 30)
      for (const f of selected) {
        expect(f.startMs).toBe(Math.round((f.index * 1000) / 60))
        expect(f.presentationMs ?? f.startMs).toBeGreaterThanOrEqual(f.startMs)
        expect(f.presentationMs ?? f.startMs).toBeLessThan(f.endMs)
      }
    }
  })
  it('does not wait for a missing future frame when current frame covers due; protects EOF', () => {
    const c = new DecodeCadence(),
      all = frames()
    all.forEach((f) => c.observeFrame(f.durationMs))
    c.enable()
    c.dispatched(all[0]!, false)
    expect(c.needsSuccessor(all[2]!, false)).toBe(false)
    expect(c.needsSuccessor(all[1]!, false)).toBe(true)
    expect(c.needsSuccessor(all[1]!, true)).toBe(false)
    expect(c.skip(all[1]!)).toBeFalsy()
  })
  it('replaces a long first duration with rolling measurements and protects low frame rate', () => {
    const c = new DecodeCadence()
    c.enable()
    c.observeFrame(1000)
    for (let i = 0; i < 32; i++) c.observeFrame(17)
    expect(c.sourceFps).toBeGreaterThan(45)
    const low = new DecodeCadence()
    low.enable()
    low.observeFrame(40)
    expect(low.skip(frames()[1]!, frames()[2])).toBe(false)
  })
  it('accumulates effective media across attempts and isolates stale/paused/calibrating samples', () => {
    const p = new PlaybackPressure(),
      first = p.begin(0)
    p.observe(first, 1, 60, 8)
    expect(p.advance(first, 5000)).toBe(false)
    p.inactive(first, 5000)
    const second = p.begin(5100)
    p.observe(first, 0, 30, 100)
    expect(p.advance(second, 1000)).toBe(false)
    p.observe(second, 1, 60, 8)
    expect(p.advance(second, 1000)).toBe(false)
    expect(p.advance(second, 3999)).toBe(false)
    expect(p.advance(second, 4000)).toBe(true)
    p.inactive(second, 9100)
    const third = p.begin(70100)
    expect(p.advance(third, 0)).toBe(false)
  })
  it('resets sustained pressure on lighter work, and explicit preview reset rejects old attempts', () => {
    const p = new PlaybackPressure(),
      token = p.begin(0)
    p.observe(token, 1, 60, 8)
    p.advance(token, 7000)
    p.observe(token, 0.8, 60, 9)
    p.advance(token, 8000)
    p.observe(token, 1, 60, 10)
    expect(p.advance(token, 15000)).toBe(false)
    p.reset()
    expect(p.advance(token, 25000)).toBe(false)
  })
  it('retains the paused instance after a long rest but recalibrates the next attempt', () => {
    const p = new PlaybackPressure(),
      token = p.begin(0)
    p.observe(token, 1, 60, 8)
    expect(p.advance(token, 8000)).toBe(true)
    p.inactive(token, 8000)
    p.active(token, 68000)
    expect(p.advance(token, 8100)).toBe(true)
    p.inactive(token, 68100)
    const next = p.begin(68200)
    expect(p.advance(next, 0)).toBe(false)
  })
})
