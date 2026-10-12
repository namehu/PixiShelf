import { describe, it, expect, vi } from 'vitest'
import { PlaybackDiagnostics, TimingSamples } from '../diagnostics'
import type { Frame } from '../types'

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
  it('bounds frame traces, separates source and display time, and exports detached records', () => {
    vi.stubGlobal('window', { innerWidth: 384, innerHeight: 800, devicePixelRatio: 3 })
    vi.stubGlobal('navigator', { userAgent: 'test' })
    try {
      const diagnostics = new PlaybackDiagnostics('timeline', 'test')
      for (let index = 0; index < 5000; index++) {
        const frame: Frame = {
          index,
          cycleId: 0,
          width: 1,
          height: 1,
          durationMs: 17,
          startMs: index * 17,
          presentationMs: index * 17 + 0.5,
          pixels: new ArrayBuffer(4)
        }
        diagnostics.frameAvailable(frame)
        if (index % 2 === 0) diagnostics.frameDrawn(frame, index * 17 + 1)
      }
      const report = diagnostics.report()
      expect(report.presentationTrace).toHaveLength(4096)
      expect(report.presentationTrace![0]).toMatchObject({ startMs: 0, presentationMs: 0.5, mediaPositionMs: 1 })
      expect(report.presentationTrace![1]!.drawnMs).toBeNull()
      report.presentationTrace![0]!.index = -1
      expect(diagnostics.report().presentationTrace![0]!.index).toBe(0)
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
