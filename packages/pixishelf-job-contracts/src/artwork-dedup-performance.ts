import { z } from 'zod'
import { artworkDedupProgressPhaseSchema } from './job-progress-data.ts'

const count = z.number().int().nonnegative().safe().nullable()
const duration = z.number().nonnegative().finite().nullable()

export const artworkDedupPerformanceCountersSchema = z.object({
  readBytes: count,
  decodedImages: count,
  ownFeatureHits: count,
  contentFeatureHits: count,
  relationReusedPairs: count,
  relationInvalidatedPairs: count,
  indexNodeVisits: count,
  wholeChannelHits: count,
  localChannelHits: count,
  candidatePairs: count,
  compareCalls: count,
  dbLoadCalls: count,
  // Historical name: all executor-body transaction reads, not only validation.
  dbValidationCalls: count,
  dbWriteCalls: count,
  // Queue execution-fence API calls are outside the executor-body proxy.
  dbFenceCalls: count.optional(),
  transactions: count,
  hotBatches: count.optional(),
  originalCacheHits: count.optional(),
  hashedOriginals: count.optional(),
  metadataFallbacks: count.optional(),
  reusedArtworks: count.optional(),
  reusedRelations: count.optional(),
  copiedRows: count.optional(),
  // Successfully committed copy work later discarded after source/projection changes.
  discardedCopyRows: count.optional(),
  discardedReusedRelations: count.optional(),
  indexRebuilds: count,
  replayedQueries: count,
  replayedComparisons: count
}).strict()

export const artworkDedupPerformanceDurationsSchema = z.object({
  feature: duration,
  index: duration,
  query: duration,
  compare: duration,
  pair: duration,
  dbLoad: duration,
  dbValidation: duration,
  dbWrite: duration,
  transactionWall: duration,
  propertyInspection: duration.optional(),
  fingerprintReuse: duration.optional(),
  relationReuse: duration.optional(),
  resultCopy: duration.optional(),
  transactionAcquisition: duration.optional(),
  transactionPreFence: duration.optional(),
  transactionBody: duration.optional(),
  transactionPostFence: duration.optional(),
  transactionCommitFinalization: duration.optional(),
  active: duration,
  queue: duration,
  cooldown: duration,
  pause: duration
}).strict()

export const artworkDedupPerformanceProgressSchema = z.object({
  originals: count,
  staticImages: count,
  uncheckedMedia: count,
  queryCompleted: count,
  queryTotal: count
}).strict()

/** Only aggregate values enter Worker logs, job events and the run snapshot. */
export const artworkDedupPerformanceSummarySchema = z.object({
  version: z.literal(1),
  kind: z.literal('artwork-dedup-performance'),
  runId: z.string().min(1).max(128),
  jobId: z.string().min(1).max(128),
  protocolVersion: z.number().int().positive().safe(),
  searchVersion: z.string().min(1).max(128).nullable(),
  inputDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
  phase: artworkDedupProgressPhaseSchema,
  batch: z.number().int().nonnegative().safe(),
  updatedAt: z.string().datetime({ offset: true }),
  complete: z.boolean(),
  progress: artworkDedupPerformanceProgressSchema,
  counters: artworkDedupPerformanceCountersSchema,
  durationsMs: artworkDedupPerformanceDurationsSchema,
  memoryPeakBytes: count,
  metadataPeakBytes: count.optional(),
  // A snapshot written inside a transaction cannot include that transaction's
  // post-fence/commit duration. No extra write is made just to close this gap.
  transactionTiming: z.object({
    sampledTransactions: z.number().int().nonnegative().safe(),
    cutoff: z.string().datetime({ offset: true }).nullable(),
    complete: z.boolean()
  }).strict().optional(),
  cacheInvalidationReasons: z.array(z.enum(['FULL', 'SEARCH_VERSION', 'INPUT_CHANGED', 'INCOMPLETE', 'MISSING']))
}).strict()

export type ArtworkDedupPerformanceSummary = z.infer<typeof artworkDedupPerformanceSummarySchema>
export type ArtworkDedupPerformanceCounters = z.infer<typeof artworkDedupPerformanceCountersSchema>
export type ArtworkDedupPerformanceDurations = z.infer<typeof artworkDedupPerformanceDurationsSchema>
