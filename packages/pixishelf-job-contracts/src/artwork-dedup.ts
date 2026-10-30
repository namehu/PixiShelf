import { z } from 'zod'
import { jobStatusSchema } from './job-types.ts'
import { artworkDedupProgressDataSchema } from './job-progress-data.ts'

export const ARTWORK_DEDUP_SCAN_DEFINITION_VERSION = 9 as const
export const ARTWORK_DEDUP_PRIORITY = 900 as const
export const ARTWORK_DEDUP_DEFAULTS = Object.freeze({
  mediaPageSize: 500,
  statConcurrency: 4,
  hashConcurrency: 1,
  cacheBatchSize: 100,
  yieldAfterMs: 10_000,
  yieldAfterBytes: 268_435_456,
  cooldownMs: 3_000,
  stallTimeoutMs: 30_000
})
const id = z.string().trim().min(1).max(128)
const version = z.number().int().positive().safe()
export const artworkDedupModeSchema = z.enum(['INCREMENTAL', 'FULL'])
export const artworkDedupControlActionSchema = z.enum(['pause', 'resume', 'cancel', 'retry'])
export type ArtworkDedupControlAction = z.infer<typeof artworkDedupControlActionSchema>
export const artworkDedupScanPayloadSchema = z.object({ runId: id, executionVersion: version }).strict()
export type ArtworkDedupScanPayload = z.infer<typeof artworkDedupScanPayloadSchema>
export const artworkDedupStartInputSchema = z
  .object({
    artistId: version,
    expectedUserId: id,
    idempotencyKey: id,
    mode: artworkDedupModeSchema.default('INCREMENTAL'),
    includeSuspectedVersions: z.boolean().default(false)
  })
  .strict()
export const artworkDedupGetRunInputSchema = z.union([
  z.object({ runId: id, expectedUserId: id }).strict(),
  z.object({ artistId: version, expectedUserId: id }).strict()
])
export const artworkDedupControlInputSchema = z
  .object({
    runId: id,
    expectedUserId: id,
    expectedVersion: version,
    idempotencyKey: id,
    action: artworkDedupControlActionSchema
  })
  .strict()
export const artworkDedupListGroupsInputSchema = z
  .object({ runId: id, expectedUserId: id, cursor: id.optional(), limit: z.number().int().min(1).max(50).default(20) })
  .strict()
const count = z.number().int().nonnegative()
export const artworkDedupRunDtoSchema = z.object({
  progressData: artworkDedupProgressDataSchema.nullable().default(null),
  includesPartial: z.boolean().default(false),
  includesContainment: z.boolean().default(false),
  visualStatus: z.enum(['NOT_REQUESTED', 'PENDING', 'COMPLETE', 'INCOMPLETE']).default('NOT_REQUESTED'),
  visualIncompleteReasons: z.array(z.string()).default([]),
  pauseReason: z.literal('VISUAL_COMPARISON_BUDGET').nullable().default(null),
  runId: id,
  artistId: version,
  artistName: z.string(),
  jobId: id.nullable(),
  version,
  executionVersion: version,
  status: jobStatusSchema,
  stage: z.enum(['STAT', 'CANDIDATES', 'HASH', 'GROUP', 'MATCH', 'VISUAL', 'DONE']),
  mode: artworkDedupModeSchema,
  frozenAt: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  lastCompletedRun: z
    .object({ runId: id, version, finishedAt: z.string().nullable(), groupCount: count })
    .nullable()
    .default(null),
  counts: z.object({
    artworks: count,
    processedArtworks: count,
    completeArtworks: count,
    changedArtworks: count,
    failedArtworks: count,
    skippedArtworks: count,
    groups: count,
    duplicateArtworks: count,
    statMedia: count,
    hashedMedia: count,
    cacheHitMedia: count,
    visualUncheckedMedia: count.nullable().default(null),
    readBytes: z.string().regex(/^\d+$/)
  }),
  allowedControls: z.array(artworkDedupControlActionSchema),
  failure: z.object({ code: z.string(), message: z.string() }).nullable()
})
export type ArtworkDedupRunDto = z.infer<typeof artworkDedupRunDtoSchema>
