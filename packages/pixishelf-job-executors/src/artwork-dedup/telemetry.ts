import type {
  ArtworkDedupPerformanceCounters,
  ArtworkDedupPerformanceDurations,
  ArtworkDedupPerformanceSummary,
  ArtworkDedupProgressData
} from '@pixishelf/job-contracts'

type PerformanceIdentity = Pick<ArtworkDedupPerformanceSummary,
  'runId' | 'jobId' | 'protocolVersion' | 'searchVersion' | 'inputDigest' | 'phase' | 'updatedAt'>
type MeasuredDelta<T> = Partial<{ [K in keyof T]: number }>

export function createArtworkDedupPerformance(input: PerformanceIdentity): ArtworkDedupPerformanceSummary {
  return {
    ...input,
    version: 1,
    kind: 'artwork-dedup-performance',
    batch: 0,
    complete: false,
    progress: { originals: null, staticImages: null, uncheckedMedia: null, queryCompleted: null, queryTotal: null },
    counters: {
      readBytes: null, decodedImages: null, ownFeatureHits: null, contentFeatureHits: null,
      relationReusedPairs: null, relationInvalidatedPairs: null, indexNodeVisits: null,
      wholeChannelHits: null, localChannelHits: null, candidatePairs: null, compareCalls: null,
      dbLoadCalls: null, dbValidationCalls: null, dbWriteCalls: null, transactions: null,
      dbFenceCalls: null, hotBatches: null, reusedArtworks: null, reusedRelations: null, copiedRows: null,
      originalCacheHits: null, hashedOriginals: null,
      metadataFallbacks: null, discardedCopyRows: null, discardedReusedRelations: null,
      indexRebuilds: null, replayedQueries: null, replayedComparisons: null
    },
    durationsMs: {
      feature: null, index: null, query: null, compare: null, pair: null, dbLoad: null,
      dbValidation: null, dbWrite: null, transactionWall: null, active: null, queue: null,
      cooldown: null, pause: null, propertyInspection: null, fingerprintReuse: null,
      relationReuse: null, resultCopy: null, transactionAcquisition: null,
      transactionPreFence: null, transactionBody: null, transactionPostFence: null,
      transactionCommitFinalization: null
    },
    memoryPeakBytes: null,
    metadataPeakBytes: null,
    cacheInvalidationReasons: []
  }
}

export interface ArtworkDedupPerformanceDelta {
  updatedAt: string
  phase?: ArtworkDedupPerformanceSummary['phase']
  searchVersion?: string | null
  inputDigest?: string | null
  complete?: boolean
  progress?: Partial<ArtworkDedupPerformanceSummary['progress']>
  counters?: MeasuredDelta<ArtworkDedupPerformanceCounters>
  durationsMs?: MeasuredDelta<ArtworkDedupPerformanceDurations>
  memoryPeakBytes?: number
  metadataPeakBytes?: number
  transactionTiming?: ArtworkDedupPerformanceSummary['transactionTiming']
  cacheInvalidationReasons?: ArtworkDedupPerformanceSummary['cacheInvalidationReasons']
}

/** Commit the returned value with results and the cursor; retain it only after commit. */
export function advanceArtworkDedupPerformance(
  previous: ArtworkDedupPerformanceSummary,
  delta: ArtworkDedupPerformanceDelta
): ArtworkDedupPerformanceSummary {
  const counters = { ...previous.counters }
  const durationsMs = { ...previous.durationsMs }
  for (const key of Object.keys(delta.counters ?? {}) as (keyof ArtworkDedupPerformanceCounters)[]) {
    counters[key] = (previous.counters[key] ?? 0) + delta.counters![key]!
  }
  for (const key of Object.keys(delta.durationsMs ?? {}) as (keyof ArtworkDedupPerformanceDurations)[]) {
    durationsMs[key] = (previous.durationsMs[key] ?? 0) + delta.durationsMs![key]!
  }
  return {
    ...previous,
    updatedAt: delta.updatedAt,
    phase: delta.phase ?? previous.phase,
    searchVersion: delta.searchVersion === undefined ? previous.searchVersion : delta.searchVersion,
    inputDigest: delta.inputDigest === undefined ? previous.inputDigest : delta.inputDigest,
    complete: delta.complete ?? previous.complete,
    batch: previous.batch + 1,
    progress: { ...previous.progress, ...delta.progress },
    counters,
    durationsMs,
    memoryPeakBytes: delta.memoryPeakBytes === undefined ? previous.memoryPeakBytes
      : Math.max(previous.memoryPeakBytes ?? 0, delta.memoryPeakBytes),
    ...(delta.metadataPeakBytes === undefined ? {} : {
      metadataPeakBytes: Math.max(previous.metadataPeakBytes ?? 0, delta.metadataPeakBytes)
    }),
    ...(delta.transactionTiming === undefined ? {} : { transactionTiming: delta.transactionTiming }),
    cacheInvalidationReasons: [...new Set([...previous.cacheInvalidationReasons, ...delta.cacheInvalidationReasons ?? []])]
  }
}

export function artworkDedupProgress(
  input: Omit<ArtworkDedupProgressData, 'kind' | 'version' | 'uncheckedMedia'> & { uncheckedMedia?: number | null }
): ArtworkDedupProgressData {
  return { ...input, kind: 'artwork-dedup', version: 1, uncheckedMedia: input.uncheckedMedia ?? null }
}

export type ArtworkDedupPerformanceLogReason = 'CHECKPOINT' | 'PAUSED' | 'FAILED' | 'COMPLETED' | 'CANCELLED'

export function artworkDedupPerformanceLogDue(
  lastEmitted: Pick<ArtworkDedupPerformanceSummary, 'phase' | 'updatedAt'> | null,
  next: Pick<ArtworkDedupPerformanceSummary, 'phase' | 'updatedAt'>,
  reason: ArtworkDedupPerformanceLogReason = 'CHECKPOINT'
): boolean {
  return reason !== 'CHECKPOINT' || lastEmitted === null || lastEmitted.phase !== next.phase
    || Date.parse(next.updatedAt) - Date.parse(lastEmitted.updatedAt) >= 30_000
}
