import { z } from 'zod'
import { JOB_DEFINITION_VERSION, type JobType } from './job-types.ts'
import { MEDIA_FILE_EXTENSIONS } from './media-types.ts'

export type JsonPrimitive = string | number | boolean | null
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue }

export const jsonPrimitiveSchema = z.union([z.string(), z.number().finite(), z.boolean(), z.null()])
export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(z.string(), jsonValueSchema)])
)
export const jsonObjectSchema = z.record(z.string(), jsonValueSchema)

export const jobPayloadEnvelopeSchema = z.object({
  definitionVersion: z.literal(JOB_DEFINITION_VERSION),
  input: jsonObjectSchema
})
export type JobPayloadEnvelope = z.infer<typeof jobPayloadEnvelopeSchema>

export const emptyJobPayloadSchema = z.object({}).strict()

export const pixivAiDerivedTagSyncPayloadSchema = z.object({ dryRun: z.boolean().default(true) }).strict()
export type PixivAiDerivedTagSyncPayload = z.infer<typeof pixivAiDerivedTagSyncPayloadSchema>

export const relativePathSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .refine((value) => !value.startsWith('/') && !value.startsWith('\\') && !/^[a-zA-Z]:/.test(value), {
    message: 'Expected a relative path'
  })
  .refine((value) => !value.split(/[\\/]+/).includes('..'), { message: 'Parent traversal is not allowed' })

export const sha256DigestSchema = z.string().regex(/^[a-f0-9]{64}$/, 'Expected a lowercase SHA-256 digest')

export const calendarDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a calendar date in YYYY-MM-DD format')
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`)
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
  }, 'Expected a valid calendar date')

const boundedIdSchema = z.string().trim().min(1).max(128)
const positiveArtworkIdSchema = z.number().int().positive()
const positiveTagIdSchema = z.number().int().positive()
const positiveArtistIdSchema = z.number().int().positive()
export const PIXIV_ARTWORK_ENRICHMENT_BATCH_LIMIT = 200
export const PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT = 200
export const PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT = 200
export const PIXIV_TAG_ENRICHMENT_BATCH_LIMIT = 200
const uniquePositiveTagIdsSchema = (maximum: number) =>
  z
    .array(positiveTagIdSchema)
    .max(maximum)
    .refine((values) => new Set(values).size === values.length, 'Expected unique tag ids')
    .transform((values) => [...values].sort((left, right) => left - right))

const scanIncrementalPayloadSchema = z.object({ mode: z.literal('INCREMENTAL') }).strict()
const scanClientListPayloadSchema = z
  .object({
    mode: z.literal('CLIENT_LIST'),
    existingPolicy: z.enum(['SKIP', 'REFRESH']),
    inputCount: z.number().int().min(1).max(10_000),
    inputDigest: sha256DigestSchema
  })
  .strict()
const scanArtworkRescanPayloadSchema = z
  .object({ mode: z.literal('ARTWORK_RESCAN'), artworkId: z.number().int().positive() })
  .strict()

export const scanPayloadSchema = z.discriminatedUnion('mode', [
  scanIncrementalPayloadSchema,
  scanClientListPayloadSchema,
  scanArtworkRescanPayloadSchema
])
export type ScanPayload = z.infer<typeof scanPayloadSchema>

const scanConsistencyAuditPayloadSchema = z
  .object({ mode: z.literal('CONSISTENCY_AUDIT'), verification: z.literal('FAST') })
  .strict()
export const scanAuditApplyPayloadSchema = z
  .object({
    mode: z.literal('AUDIT_APPLY'),
    auditRunId: boundedIdSchema,
    inputCount: z.number().int().min(1).max(10_000),
    inputDigest: sha256DigestSchema
  })
  .strict()

/** SCAN@v2 is versioned separately; the legacy SCAN parser intentionally remains v1-only. */
export const scanV2PayloadSchema = z.discriminatedUnion('mode', [
  scanConsistencyAuditPayloadSchema,
  scanAuditApplyPayloadSchema
])
export type ScanV2Payload = z.infer<typeof scanV2PayloadSchema>
export type ScanConsistencyAuditPayload = z.infer<typeof scanConsistencyAuditPayloadSchema>
export type ScanAuditApplyPayload = z.infer<typeof scanAuditApplyPayloadSchema>

/** SCAN@v3 admits only the write-capable apply operation. */
export const scanV3PayloadSchema = scanAuditApplyPayloadSchema
export type ScanV3Payload = z.infer<typeof scanV3PayloadSchema>

export const localDirectoryImportPayloadSchema = z
  .object({
    defaultTagIds: uniquePositiveTagIdsSchema(100).default([]),
    mappingCount: z.number().int().min(0).max(2_000),
    mappingDigest: sha256DigestSchema
  })
  .strict()
export type LocalDirectoryImportPayload = z.infer<typeof localDirectoryImportPayloadSchema>

export const migrationFilterSchema = z
  .object({
    id: z.number().int().positive().optional(),
    search: z.string().trim().min(1).max(500).optional(),
    artistName: z.string().trim().min(1).max(255).optional(),
    startDate: calendarDateSchema.optional(),
    endDate: calendarDateSchema.optional(),
    externalId: z.string().trim().min(1).max(255).optional(),
    mediaTypes: z
      .array(z.enum(MEDIA_FILE_EXTENSIONS))
      .max(MEDIA_FILE_EXTENSIONS.length)
      .refine((values) => new Set(values).size === values.length, 'Expected unique media types')
      .transform((values) => [...values].sort())
      .default([]),
    exactMatch: z.boolean().default(false)
  })
  .strict()
  .refine(
    (filters) => !filters.startDate || !filters.endDate || filters.startDate <= filters.endDate,
    'startDate must not be after endDate'
  )
export type MigrationFilter = z.infer<typeof migrationFilterSchema>

const migrationArtworkIdsSelectionSchema = z
  .object({
    mode: z.literal('ARTWORK_IDS'),
    artworkIds: z
      .array(z.number().int().positive())
      .min(1)
      .max(1_000)
      .transform((values) => [...new Set(values)].sort((left, right) => left - right))
  })
  .strict()
const migrationQuerySelectionSchema = z
  .object({
    mode: z.literal('QUERY'),
    filters: migrationFilterSchema,
    upperArtworkId: z.number().int().nonnegative()
  })
  .strict()
const migrationFailedSelectionSchema = z
  .object({ mode: z.literal('FAILED_FROM_JOB'), sourceJobId: z.string().trim().min(1).max(120) })
  .strict()

export const migrationSelectionSchema = z.discriminatedUnion('mode', [
  migrationArtworkIdsSelectionSchema,
  migrationQuerySelectionSchema,
  migrationFailedSelectionSchema
])
export type MigrationSelection = z.infer<typeof migrationSelectionSchema>

export const migrationSafetySchema = z
  .object({
    transferMode: z.enum(['move', 'copy']).default('move'),
    verifyAfterCopy: z.boolean().default(true),
    cleanupSource: z.boolean().default(true)
  })
  .strict()

export const migrationPayloadSchema = z
  .object({
    selection: migrationSelectionSchema,
    safety: migrationSafetySchema.default({
      transferMode: 'move',
      verifyAfterCopy: true,
      cleanupSource: true
    })
  })
  .strict()
export type MigrationPayload = z.infer<typeof migrationPayloadSchema>

const pendingReplaceDiscoverPayloadSchema = z
  .object({ mode: z.literal('DISCOVER'), batchId: boundedIdSchema, sourceRoot: z.literal('pending-replaces') })
  .strict()
const pendingReplaceBatchPayloadSchema = z
  .object({
    mode: z.literal('BATCH'),
    batchId: boundedIdSchema,
    itemIds: z
      .array(boundedIdSchema)
      .min(1)
      .max(5_000)
      .refine((values) => new Set(values).size === values.length, 'Expected unique pending item ids')
      .transform((values) => [...values].sort()),
    appendTagIds: uniquePositiveTagIdsSchema(1_000)
  })
  .strict()
const pendingReplaceRestorePayloadSchema = z
  .object({ mode: z.literal('RESTORE'), batchId: boundedIdSchema, itemId: boundedIdSchema })
  .strict()
const pendingReplaceCleanupPayloadSchema = z.object({ mode: z.literal('CLEANUP'), batchId: boundedIdSchema }).strict()

export const pendingReplacePayloadSchema = z.discriminatedUnion('mode', [
  pendingReplaceDiscoverPayloadSchema,
  pendingReplaceBatchPayloadSchema,
  pendingReplaceRestorePayloadSchema,
  pendingReplaceCleanupPayloadSchema
])
export type PendingReplacePayload = z.infer<typeof pendingReplacePayloadSchema>

export const targetImagePayloadSchema = z.object({
  imageId: z.number().int().positive(),
  relativePath: relativePathSchema
})

export const videoMediaProbePayloadSchema = z
  .object({
    mode: z.enum(['INCREMENTAL', 'RECHECK_HAS_AUDIO']).default('INCREMENTAL'),
    force: z.boolean().default(false),
    imageId: z.number().int().positive().optional()
  })
  .superRefine((payload, context) => {
    if (payload.imageId !== undefined && !payload.force) {
      context.addIssue({ code: 'custom', path: ['force'], message: 'A targeted video reprobe must set force=true' })
    }
    if (payload.mode === 'RECHECK_HAS_AUDIO' && (!payload.force || payload.imageId !== undefined)) {
      context.addIssue({
        code: 'custom',
        path: ['mode'],
        message: 'An audio recheck must set force=true and cannot target a single image'
      })
    }
  })

export const videoChapterPreviewPayloadSchema = z.object({
  mode: z.enum(['FULL', 'INCREMENTAL']).default('INCREMENTAL')
})

export const videoStreamingOptimizationPayloadSchema = targetImagePayloadSchema.extend({
  mode: z.literal('REMUX_FASTSTART')
})

export const videoKeyframeFilterSchema = z.object({
  minDuration: z.number().finite().nonnegative().nullable().default(null),
  maxDuration: z.number().finite().positive().nullable().default(null),
  includePaths: z.array(relativePathSchema).max(1_000).default([]),
  excludePaths: z.array(relativePathSchema).max(1_000).default([]),
  statuses: z
    .array(z.enum(['MISSING', 'STALE', 'FAILED']))
    .max(3)
    .default(['MISSING', 'STALE', 'FAILED'])
})

export const videoKeyframeDiscoveryPayloadSchema = z.object({
  trigger: z.enum(['manual', 'schedule']),
  force: z.boolean().default(false),
  previewOnly: z.boolean().default(false),
  imageIds: z.array(z.number().int().positive()).max(1_000).optional(),
  afterImageId: z.number().int().positive().optional(),
  filter: videoKeyframeFilterSchema
})

export const videoKeyframeGenerationPayloadSchema = targetImagePayloadSchema.extend({
  mode: z.enum(['AUTO_INCREMENTAL', 'MANUAL_INCREMENTAL', 'MANUAL_FORCE'])
})

export const archiveImportPayloadSchema = z.object({
  archiveImportId: z.string().min(1)
})
export type ArchiveImportPayload = z.infer<typeof archiveImportPayloadSchema>

export const archiveImportV2PayloadSchema = z
  .object({
    archiveImportId: boundedIdSchema,
    defaultTagIds: uniquePositiveTagIdsSchema(100)
  })
  .strict()
export type ArchiveImportV2Payload = z.infer<typeof archiveImportV2PayloadSchema>

const archiveDefaultTagBackfillTagIdsSchema = z
  .array(positiveTagIdSchema)
  .min(1)
  .max(100)
  .refine((values) => new Set(values).size === values.length, 'Expected unique tag ids')
  .transform((values) => [...values].sort((left, right) => left - right))

const nonnegativeSafeIntegerSchema = z.number().int().nonnegative().safe()

export const archiveDefaultTagBackfillPayloadSchema = z
  .object({
    defaultTagIds: archiveDefaultTagBackfillTagIdsSchema,
    targetMaxArtworkId: nonnegativeSafeIntegerSchema,
    targetArtworkCount: nonnegativeSafeIntegerSchema,
    expectedExistingRelations: nonnegativeSafeIntegerSchema,
    expectedMissingRelations: nonnegativeSafeIntegerSchema,
    snapshotDigest: sha256DigestSchema
  })
  .strict()
export type ArchiveDefaultTagBackfillPayload = z.infer<typeof archiveDefaultTagBackfillPayloadSchema>

export const archiveDefaultTagBackfillCheckpointSchema = z
  .object({
    kind: z.literal('CHECKPOINT'),
    afterArtworkId: nonnegativeSafeIntegerSchema,
    processedArtworks: nonnegativeSafeIntegerSchema,
    addedRelations: nonnegativeSafeIntegerSchema,
    existingRelations: nonnegativeSafeIntegerSchema,
    skippedTagIds: z.array(positiveTagIdSchema).max(100)
  })
  .strict()
export type ArchiveDefaultTagBackfillCheckpoint = z.infer<typeof archiveDefaultTagBackfillCheckpointSchema>

export const archiveDefaultTagBackfillResultSchema = z
  .object({
    kind: z.literal('COMPLETED'),
    targetArtworks: nonnegativeSafeIntegerSchema,
    processedArtworks: nonnegativeSafeIntegerSchema,
    addedRelations: nonnegativeSafeIntegerSchema,
    existingRelations: nonnegativeSafeIntegerSchema,
    skippedArtworks: nonnegativeSafeIntegerSchema,
    failedArtworks: nonnegativeSafeIntegerSchema,
    skippedTagIds: z.array(positiveTagIdSchema).max(100)
  })
  .strict()
export type ArchiveDefaultTagBackfillResult = z.infer<typeof archiveDefaultTagBackfillResultSchema>

const cleanArchiveStagingPayloadSchema = z
  .object({ action: z.literal('CLEAN_STAGING'), archiveImportId: boundedIdSchema })
  .strict()
const archiveArtworkMaintenancePayloadSchema = z
  .object({
    action: z.enum(['TRASH_ARCHIVE', 'RESTORE_ARCHIVE']),
    artworkId: z.number().int().positive()
  })
  .strict()

const purgeArchivePayloadSchema = z
  .object({
    action: z.literal('PURGE_ARCHIVE'),
    artworkId: z.number().int().positive()
  })
  .strict()

const reconcileArchiveMaintenancePayloadSchema = z.object({ action: z.literal('RECONCILE') }).strict()

export const archiveMaintenancePayloadSchema = z.discriminatedUnion('action', [
  cleanArchiveStagingPayloadSchema,
  archiveArtworkMaintenancePayloadSchema,
  purgeArchivePayloadSchema,
  reconcileArchiveMaintenancePayloadSchema
])
export type ArchiveMaintenancePayload = z.infer<typeof archiveMaintenancePayloadSchema>

export const archiveResolveItemPayloadSchema = z
  .object({
    intakeItemId: boundedIdSchema
  })
  .strict()
export type ArchiveResolveItemPayload = z.infer<typeof archiveResolveItemPayloadSchema>

export const derivedMediaGcPayloadSchema = z.object({
  entryIds: z.array(z.string().min(1)).max(1_000).optional(),
  dryRun: z.boolean().default(false),
  reconcile: z.boolean().default(false)
})

const pixivTagEnrichmentDiscoverPayloadSchema = z
  .object({
    mode: z.literal('DISCOVER'),
    force: z.boolean().default(false),
    refreshExisting: z.boolean().default(false),
    // Persisted jobs created before the bounded-batch rollout may contain up to 1,000 selected IDs.
    // New producers enforce PIXIV_TAG_ENRICHMENT_BATCH_LIMIT without invalidating those queued payloads.
    tagIds: z.array(z.number().int().positive()).min(1).max(1_000).optional()
  })
  .strict()

const pixivTagEnrichmentTagPayloadSchema = z
  .object({
    mode: z.literal('TAG'),
    tagId: z.number().int().positive(),
    expectedName: z.string().trim().min(1).max(255),
    force: z.boolean().default(false),
    refreshExisting: z.boolean().default(false)
  })
  .strict()

export const pixivTagEnrichmentPayloadSchema = z.discriminatedUnion('mode', [
  pixivTagEnrichmentDiscoverPayloadSchema,
  pixivTagEnrichmentTagPayloadSchema
])
export type PixivTagEnrichmentPayload = z.infer<typeof pixivTagEnrichmentPayloadSchema>

const pixivArtistEnrichmentDiscoverPayloadSchema = z
  .object({
    mode: z.literal('DISCOVER'),
    force: z.boolean().default(false),
    refreshExisting: z.boolean().default(false),
    artistIds: z.array(positiveArtistIdSchema).min(1).max(PIXIV_ARTIST_ENRICHMENT_BATCH_LIMIT).optional()
  })
  .strict()

const pixivArtistEnrichmentArtistPayloadSchema = z
  .object({
    mode: z.literal('ARTIST'),
    artistId: positiveArtistIdSchema,
    expectedExternalRefId: boundedIdSchema,
    expectedPixivUserId: z.string().regex(/^[1-9][0-9]*$/),
    force: z.boolean().default(false),
    refreshExisting: z.boolean().default(false)
  })
  .strict()

export const pixivArtistEnrichmentPayloadSchema = z.discriminatedUnion('mode', [
  pixivArtistEnrichmentDiscoverPayloadSchema,
  pixivArtistEnrichmentArtistPayloadSchema
])
export type PixivArtistEnrichmentPayload = z.infer<typeof pixivArtistEnrichmentPayloadSchema>

const pixivArtworkEnrichmentDiscoverPayloadSchema = z
  .object({
    mode: z.literal('DISCOVER'),
    refreshExisting: z.boolean().default(false),
    adoptSourceText: z.boolean().default(false),
    artworkIds: z
      .array(positiveArtworkIdSchema)
      .min(1)
      .max(PIXIV_ARTWORK_ENRICHMENT_BATCH_LIMIT)
      .refine((values) => new Set(values).size === values.length, 'Expected unique artwork ids')
      .optional()
  })
  .strict()

const pixivArtworkEnrichmentArtworkPayloadSchema = z
  .object({
    mode: z.literal('ARTWORK'),
    artworkId: positiveArtworkIdSchema,
    expectedExternalRefId: boundedIdSchema,
    expectedPixivArtworkId: z.string().regex(/^[1-9][0-9]*$/),
    adoptSourceText: z.boolean().default(false)
  })
  .strict()

export const pixivArtworkEnrichmentPayloadSchema = z.discriminatedUnion('mode', [
  pixivArtworkEnrichmentDiscoverPayloadSchema,
  pixivArtworkEnrichmentArtworkPayloadSchema
])
export type PixivArtworkEnrichmentPayload = z.infer<typeof pixivArtworkEnrichmentPayloadSchema>

const pixivSeriesReconciliationDiscoverPayloadSchema = z
  .object({
    mode: z.literal('DISCOVER'),
    refreshExisting: z.boolean().default(false),
    artworkIds: z
      .array(positiveArtworkIdSchema)
      .min(1)
      .max(PIXIV_SERIES_RECONCILIATION_BATCH_LIMIT)
      .refine((values) => new Set(values).size === values.length, 'Expected unique artwork ids')
      .optional()
  })
  .strict()

const pixivSeriesReconciliationArtworkPayloadSchema = z
  .object({
    mode: z.literal('ARTWORK'),
    artworkId: positiveArtworkIdSchema,
    expectedExternalRefId: boundedIdSchema,
    expectedPixivArtworkId: z.string().regex(/^[1-9][0-9]*$/),
    refreshExisting: z.boolean().default(false)
  })
  .strict()

export const pixivSeriesReconciliationPayloadSchema = z.discriminatedUnion('mode', [
  pixivSeriesReconciliationDiscoverPayloadSchema,
  pixivSeriesReconciliationArtworkPayloadSchema
])
export type PixivSeriesReconciliationPayload = z.infer<typeof pixivSeriesReconciliationPayloadSchema>

export const JOB_PAYLOAD_SCHEMAS = {
  SCAN: scanPayloadSchema,
  LOCAL_DIRECTORY_IMPORT: localDirectoryImportPayloadSchema,
  MIGRATION: migrationPayloadSchema,
  PENDING_REPLACE: pendingReplacePayloadSchema,
  REFILL_META_SOURCE: emptyJobPayloadSchema,
  MEDIA_DERIVED_TAG_SYNC: emptyJobPayloadSchema,
  PIXIV_AI_DERIVED_TAG_SYNC: pixivAiDerivedTagSyncPayloadSchema,
  WEBP_ANIMATION_SCAN: emptyJobPayloadSchema,
  VIDEO_MEDIA_PROBE: videoMediaProbePayloadSchema,
  VIDEO_POSTER_GENERATION: targetImagePayloadSchema,
  VIDEO_CHAPTER_PREVIEW_GENERATION: videoChapterPreviewPayloadSchema,
  VIDEO_STREAMING_OPTIMIZATION: videoStreamingOptimizationPayloadSchema,
  VIDEO_KEYFRAME_DISCOVERY: videoKeyframeDiscoveryPayloadSchema,
  VIDEO_KEYFRAME_GENERATION: videoKeyframeGenerationPayloadSchema,
  ARCHIVE_RESOLVE_ITEM: archiveResolveItemPayloadSchema,
  ARCHIVE_IMPORT: archiveImportPayloadSchema,
  ARCHIVE_DEFAULT_TAG_BACKFILL: archiveDefaultTagBackfillPayloadSchema,
  ARCHIVE_MAINTENANCE: archiveMaintenancePayloadSchema,
  ARCHIVE_INTAKE_RETENTION_CLEANUP: emptyJobPayloadSchema,
  SCAN_RUN_RETENTION_CLEANUP: emptyJobPayloadSchema,
  TRIGGER_LOG_RETENTION_CLEANUP: emptyJobPayloadSchema,
  DERIVED_MEDIA_GC: derivedMediaGcPayloadSchema,
  PIXIV_ARTWORK_ENRICHMENT: pixivArtworkEnrichmentPayloadSchema,
  PIXIV_ARTIST_ENRICHMENT: pixivArtistEnrichmentPayloadSchema,
  PIXIV_SERIES_RECONCILIATION: pixivSeriesReconciliationPayloadSchema,
  PIXIV_TAG_ENRICHMENT: pixivTagEnrichmentPayloadSchema
} satisfies Record<JobType, z.ZodType>

export function parseJobPayload(type: JobType, payload: unknown) {
  return JOB_PAYLOAD_SCHEMAS[type].parse(payload)
}
