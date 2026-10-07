import { describe, it, expect } from 'vitest'
import { TimingSamples } from '../diagnostics'

describe('bounded diagnostic samples', () => {
  it('keeps exact totals and a bounded reservoir', () => {
    const samples = new TimingSamples()
    for (let index = 0; index < 10000; index++) samples.add(2)
    samples.add(NaN)
    samples.add(-1)
    expect(samples.summary()).toEqual({
      count: 10000,
      samples: 4096,
      totalMs: 20000,
      meanMs: 2,
      p50Ms: 2,
      p95Ms: 2,
      maxMs: 2
    })
  })
  it('reports empty and small samples without mutating observations', () => {
    const samples = new TimingSamples()
    expect(samples.summary().meanMs).toBe(0)
    ;[1, 2, 3, 4].forEach((value) => samples.add(value))
    expect(samples.summary()).toMatchObject({ count: 4, p50Ms: 2, p95Ms: 4, maxMs: 4 })
    expect(samples.summary().count).toBe(4)
  })
})
