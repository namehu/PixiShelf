import { describe, expect, it } from 'vitest'
import { artworkDedupPerformanceSummarySchema } from '@pixishelf/job-contracts'
import { advanceArtworkDedupPerformance, artworkDedupPerformanceLogDue, artworkDedupProgress, createArtworkDedupPerformance } from '../telemetry.ts'

const identity = {
  runId: 'run', jobId: 'job', protocolVersion: 8, searchVersion: 'visual-search-v2', inputDigest: 'a'.repeat(64),
  phase: 'VISUAL' as const, updatedAt: '2026-10-29T00:00:00.000Z'
}

describe('artwork detection aggregate telemetry', () => {
  it('keeps unmeasured values unknown and separates database calls, transactions and comparisons', () => {
    const first = createArtworkDedupPerformance(identity)
    const next = advanceArtworkDedupPerformance(first, {
      updatedAt: identity.updatedAt, counters: { dbLoadCalls: 3, transactions: 1, compareCalls: 30, readBytes: 0 },
      durationsMs: { transactionWall: 9.5 }, progress: { queryCompleted: 2, queryTotal: 4 }
    })
    expect(artworkDedupPerformanceSummarySchema.parse(next)).toEqual(next)
    expect(next.counters).toMatchObject({ dbLoadCalls: 3, transactions: 1, compareCalls: 30, readBytes: 0, decodedImages: null })
    expect(next.durationsMs).toMatchObject({ transactionWall: 9.5, dbLoad: null })
    expect(next.progress).toMatchObject({ queryCompleted: 2, queryTotal: 4, uncheckedMedia: null })
  })
  it('does not mutate committed counters when an uncommitted batch is replayed', () => {
    const base = createArtworkDedupPerformance(identity)
    const delta = { updatedAt: identity.updatedAt, counters: { compareCalls: 12 }, memoryPeakBytes: 500, cacheInvalidationReasons: ['INPUT_CHANGED'] as const }
    const firstAttempt = advanceArtworkDedupPerformance(base, { ...delta, cacheInvalidationReasons: [...delta.cacheInvalidationReasons] })
    const retried = advanceArtworkDedupPerformance(base, { ...delta, cacheInvalidationReasons: [...delta.cacheInvalidationReasons] })
    expect(retried).toEqual(firstAttempt)
    expect(base.counters.compareCalls).toBeNull()
    const committed = advanceArtworkDedupPerformance(retried, {
      updatedAt: identity.updatedAt, counters: { compareCalls: 3, replayedComparisons: 12 }, memoryPeakBytes: 400,
      cacheInvalidationReasons: ['INPUT_CHANGED']
    })
    expect(committed.counters).toMatchObject({ compareCalls: 15, replayedComparisons: 12 })
    expect(committed.memoryPeakBytes).toBe(500)
    expect(committed.cacheInvalidationReasons).toEqual(['INPUT_CHANGED'])
  })
  it('emits only on the 30-second interval, phase changes and lifecycle boundaries', () => {
    const first = createArtworkDedupPerformance(identity)
    const at = (seconds: number) => ({ ...first, updatedAt: new Date(Date.parse(first.updatedAt) + seconds * 1000).toISOString() })
    expect(artworkDedupPerformanceLogDue(null, first)).toBe(true)
    expect(artworkDedupPerformanceLogDue(first, at(29))).toBe(false)
    expect(artworkDedupPerformanceLogDue(first, at(30))).toBe(true)
    expect(artworkDedupPerformanceLogDue(first, { ...at(1), phase: 'PAIR' })).toBe(true)
    for (const reason of ['PAUSED', 'FAILED', 'COMPLETED', 'CANCELLED'] as const) expect(artworkDedupPerformanceLogDue(first, at(1), reason)).toBe(true)
  })
  it('exposes no path, SQL parameter or arbitrary error payload field', () => {
    const summary = createArtworkDedupPerformance(identity)
    expect(artworkDedupPerformanceSummarySchema.safeParse({ ...summary, path: '/private/image.png' }).success).toBe(false)
    expect(artworkDedupPerformanceSummarySchema.safeParse({ ...summary, cacheInvalidationReasons: ['/private/image.png'] }).success).toBe(false)
    expect(artworkDedupPerformanceSummarySchema.safeParse({ ...summary, counters: { ...summary.counters, sqlStatements: 5 } }).success).toBe(false)
  })
  it('builds versioned phase progress with explicit unknown unchecked coverage', () => {
    expect(artworkDedupProgress({ phase: 'PAIR', completed: null, total: null, unit: 'pairs', waitReason: null, updatedAt: identity.updatedAt }))
      .toEqual({ kind: 'artwork-dedup', version: 1, phase: 'PAIR', completed: null, total: null, unit: 'pairs', waitReason: null, uncheckedMedia: null, updatedAt: identity.updatedAt })
  })
})
