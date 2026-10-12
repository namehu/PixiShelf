import assert from 'node:assert/strict'
import { test } from 'node:test'
import { rounded60fps, selectFrames, projectDraws, gapSummary } from '../experiments/cadence-audit.mjs'

test('integer source timestamps alone produce alternating refresh intervals with every frame ready', () => {
  const frames = selectFrames(rounded60fps(), { policy: 'historical' })
  assert.equal(frames.length, 153)
  assert.deepEqual(gapSummary(projectDraws(frames)).binsMs, [17, 33, 50])
  assert.equal(gapSummary(projectDraws(frames, { phaseMs: 4 })).p95, 33.33)
})

test('historical off-grid activation introduces 17/50ms SOURCE gaps, independent of RAF or decode', () => {
  const frames = selectFrames(rounded60fps(), { activationAfter: 11, policy: 'historical' })
  const gaps = frames.slice(21, -1).map((f, i) => f.startMs - frames[i + 20].startMs)
  assert.ok(gaps.some((g) => g <= 17))
  assert.ok(gaps.some((g) => g >= 50))
  assert.equal(gapSummary(projectDraws(frames, { phaseMs: 4 })).p95, 50)
})

test('integer grid and separate deadlines remove rounding jitter across activation and refresh phases', () => {
  for (let activationAfter = 0; activationAfter <= 32; activationAfter++) {
    const frames = selectFrames(rounded60fps(), { activationAfter })
    assert.equal(frames[0].index, 0)
    assert.equal(frames.at(-1).index, 303)
    assert.ok(frames.every((f) => f.paintMs >= f.startMs && f.paintMs < f.endMs))
    for (const hz of [30, 60, 90, 120])
      for (const phaseMs of [-0.5, 0, 0.2, 0.49, 0.51, 1, 4, 8]) {
        const draws = projectDraws(frames, { hz, phaseMs, deadlines: true })
        const gaps = gapSummary(draws, 1000)
        assert.equal(gaps.p95, 33.33, JSON.stringify({ activationAfter, hz, phaseMs, gaps }))
        assert.equal(draws.at(-1).index, 303)
      }
  }
})

test('a stable grid does not promise to remove actual RAF jitter or unequal refresh rates', () => {
  const frames = selectFrames(rounded60fps())
  const draws = projectDraws(frames, { deadlines: true, phaseMs: 0.5, jitter: (i) => (i % 4 < 2 ? -0.2 : 0.2) })
  assert.ok(gapSummary(draws).max > 33.34)
  for (const hz of [20, 59.94, 75]) {
    const result = projectDraws(frames, { hz, deadlines: true })
    assert.equal(result.at(-1).index, 303)
    assert.ok(result.every((f) => f.at >= f.startMs))
  }
})

test('long holds and irregular durations keep original timestamps, never present early, retain final frame', () => {
  const durations = [1000, ...rounded60fps(64), 250, 20, 40, 11, 100]
  const selected = selectFrames(durations, { activationAfter: 11 })
  const all = selectFrames(durations, { activationAfter: Infinity })
  for (const f of selected) {
    assert.equal(f.startMs, all[f.index].startMs)
    assert.equal(f.endMs, all[f.index].endMs)
    assert.ok(f.paintMs >= f.startMs && f.paintMs < f.endMs)
  }
  assert.equal(selected[0].index, 0)
  assert.equal(selected.at(-1).index, durations.length - 1)
})
