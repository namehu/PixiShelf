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
  dbValidationCalls: count,
  dbWriteCalls: count,
  transactions: count,
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
  cacheInvalidationReasons: z.array(z.enum(['FULL', 'SEARCH_VERSION', 'INPUT_CHANGED', 'INCOMPLETE', 'MISSING']))
}).strict()

export type ArtworkDedupPerformanceSummary = z.infer<typeof artworkDedupPerformanceSummarySchema>
export type ArtworkDedupPerformanceCounters = z.infer<typeof artworkDedupPerformanceCountersSchema>
export type ArtworkDedupPerformanceDurations = z.infer<typeof artworkDedupPerformanceDurationsSchema>
