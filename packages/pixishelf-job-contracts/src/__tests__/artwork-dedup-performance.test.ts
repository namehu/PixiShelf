import { describe, expect, it } from 'vitest'
import { artworkDedupPerformanceSummarySchema } from '../artwork-dedup-performance.ts'

const legacy = {
  version: 1, kind: 'artwork-dedup-performance', runId: 'run', jobId: 'job',
  protocolVersion: 8, searchVersion: null, inputDigest: null, phase: 'ORIGINALS',
  batch: 1, updatedAt: '2026-10-30T00:00:00.000Z', complete: false,
  progress: { originals: 5, staticImages: null, uncheckedMedia: null, queryCompleted: null, queryTotal: null },
  counters: {
    readBytes: 0, decodedImages: 0, ownFeatureHits: null, contentFeatureHits: null,
    relationReusedPairs: null, relationInvalidatedPairs: null, indexNodeVisits: null,
    wholeChannelHits: null, localChannelHits: null, candidatePairs: null, compareCalls: null,
    dbLoadCalls: 1, dbValidationCalls: 4, dbWriteCalls: 2, transactions: 1,
    indexRebuilds: null, replayedQueries: null, replayedComparisons: null
  },
  durationsMs: {
    feature: null, index: null, query: null, compare: null, pair: null, dbLoad: 1,
    dbValidation: 2, dbWrite: 1, transactionWall: 4, active: 5, queue: 0, cooldown: null, pause: null
  },
  memoryPeakBytes: null, cacheInvalidationReasons: []
}

describe('hot-run performance contract compatibility', () => {
  it('preserves legacy snapshots without inventing absent measurements', () => {
    expect(artworkDedupPerformanceSummarySchema.parse(legacy)).toEqual(legacy)
    for (const protocolVersion of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const parsed = artworkDedupPerformanceSummarySchema.parse({ ...legacy, protocolVersion })
      expect(parsed.counters.dbFenceCalls).toBeUndefined()
      expect(parsed.durationsMs.transactionAcquisition).toBeUndefined()
      expect(parsed.transactionTiming).toBeUndefined()
    }
  })

  it('accepts bounded aggregate metrics and explicit incomplete commit coverage', () => {
    const current = {
      ...legacy, protocolVersion: 9, metadataPeakBytes: 300,
      counters: { ...legacy.counters, hotBatches: 1, reusedArtworks: 2, reusedRelations: 0, copiedRows: 0, dbFenceCalls: 4 },
      durationsMs: { ...legacy.durationsMs, propertyInspection: 2, fingerprintReuse: 1, relationReuse: null, resultCopy: null, transactionAcquisition: 0.5, transactionPreFence: 1, transactionBody: 2, transactionPostFence: 1, transactionCommitFinalization: 0.5 },
      transactionTiming: { sampledTransactions: 1, cutoff: legacy.updatedAt, complete: false }
    }
    expect(artworkDedupPerformanceSummarySchema.parse(current)).toEqual(current)
    expect(artworkDedupPerformanceSummarySchema.safeParse({ ...current, metadataPeakBytes: -1 }).success).toBe(false)
    expect(artworkDedupPerformanceSummarySchema.safeParse({ ...current, transactionTiming: { ...current.transactionTiming, sql: 'SELECT private' } }).success).toBe(false)
  })
})
