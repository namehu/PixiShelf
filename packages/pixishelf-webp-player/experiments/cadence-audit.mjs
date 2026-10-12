// Deterministic scheduling experiment. No media, decoder, network or screen measurement.
import { pathToFileURL } from 'node:url'

export const intervalMs = 1000 / 30
const roundingMs = 0.5

export function rounded60fps(count = 304) {
  return Array.from({ length: count }, (_, i) => Math.round(((i + 1) * 1000) / 60) - Math.round((i * 1000) / 60))
}

/** Isolates selection from throughput; activationAfter counts dispatched frames. */
export function selectFrames(durations, { activationAfter = 0, policy = 'grid' } = {}) {
  let endMs = 0
  const frames = durations.map((durationMs, index) => {
    if (!Number.isFinite(durationMs) || durationMs <= 10) throw Error('Use normalized frame durations')
    const frame = { index, startMs: endMs, endMs: endMs + durationMs }
    endMs = frame.endMs
    return frame
  })
  let active = false,
    due = 0,
    slot = 0
  const selected = []
  for (let i = 0; i < frames.length; i++) {
    const frame = frames[i],
      next = frames[i + 1]
    if (!active && selected.length >= activationAfter) {
      active = true
      if (policy === 'grid') {
        // Re-anchor once on transition; never add a period to an off-grid source timestamp.
        slot = Math.max(0, Math.ceil((due - roundingMs) / intervalMs))
        due = slot * intervalMs
      }
    }
    if (active && i !== 0 && next && next.startMs <= due + roundingMs) continue
    selected.push({
      ...frame,
      // Proposal: separate presentation deadline from the unchanged source timestamps.
      // Half a millisecond absorbs container rounding without displaying future content early.
      paintMs:
        policy === 'grid' && active && i !== 0 && next ? Math.max(frame.startMs, due + roundingMs) : frame.startMs
    })
    if (!active) due = frame.endMs
    else if (policy === 'historical') {
      // Exact update used by the 2026-10-12 phone experiment, including its phase-mixing defect.
      due = Math.max(due + intervalMs, (Math.floor((frame.startMs + roundingMs) / intervalMs) + 1) * intervalMs)
    } else {
      slot = Math.max(slot + 1, Math.floor((frame.startMs + roundingMs) / intervalMs) + 1)
      due = slot * intervalMs
    }
  }
  return selected
}

/** Frames are assumed ready. RAF jitter and phase are explicit inputs, not inferred phone data. */
export function projectDraws(frames, { hz = 60, phaseMs = 0, jitter = () => 0, deadlines = false } = {}) {
  if (!frames.length) return []
  const draws = [{ ...frames[0], at: 0 }]
  let index = 1,
    previous = 0
  const endpoint = frames.at(-1).endMs
  for (let tick = 1; index < frames.length && tick < Math.ceil(((endpoint + 1000) * hz) / 1000); tick++) {
    const at = (tick * 1000) / hz + phaseMs + jitter(tick)
    if (at <= previous) throw Error('Callbacks must be monotonic')
    previous = at
    const due = (f) => (deadlines ? f.paintMs : f.startMs)
    while (index + 1 < frames.length && due(frames[index + 1]) <= at) index++
    if (due(frames[index]) <= at) draws.push({ ...frames[index++], at })
  }
  return draws
}

export function gapSummary(draws, afterMs = 500) {
  // Exclude the transition and final-frame exception when comparing steady cadence.
  const gaps = draws.slice(1, -1).flatMap((draw, i) => (draws[i].at >= afterMs ? [draw.at - draws[i].at] : []))
  gaps.sort((a, b) => a - b)
  const round = (n) => Math.round(n * 100) / 100
  return {
    count: gaps.length,
    p95: round(gaps[Math.ceil(gaps.length * 0.95) - 1] ?? 0),
    max: round(gaps.at(-1) ?? 0),
    binsMs: [...new Set(gaps.map(Math.round))]
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const activationAfter of [0, 8, 11]) {
    for (const policy of ['historical', 'grid']) {
      const frames = selectFrames(rounded60fps(), { activationAfter, policy })
      for (const phaseMs of [0, 4]) {
        console.log(
          JSON.stringify({
            activationAfter,
            policy,
            phaseMs,
            selected: frames.length,
            gaps: gapSummary(projectDraws(frames, { phaseMs, deadlines: policy === 'grid' }))
          })
        )
      }
    }
  }
}
