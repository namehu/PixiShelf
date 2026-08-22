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
const positiveTagIdSchema = z.number().int().positive()
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
    force: z.boolean().default(false),
    imageId: z.number().int().positive().optional()
  })
  .superRefine((payload, context) => {
    if (payload.imageId !== undefined && !payload.force) {
      context.addIssue({ code: 'custom', path: ['force'], message: 'A targeted video reprobe must set force=true' })
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

export const JOB_PAYLOAD_SCHEMAS = {
  SCAN: scanPayloadSchema,
  LOCAL_DIRECTORY_IMPORT: localDirectoryImportPayloadSchema,
  MIGRATION: migrationPayloadSchema,
  PENDING_REPLACE: pendingReplacePayloadSchema,
  REFILL_META_SOURCE: emptyJobPayloadSchema,
  MEDIA_DERIVED_TAG_SYNC: emptyJobPayloadSchema,
  WEBP_ANIMATION_SCAN: emptyJobPayloadSchema,
  VIDEO_MEDIA_PROBE: videoMediaProbePayloadSchema,
  VIDEO_POSTER_GENERATION: targetImagePayloadSchema,
  VIDEO_CHAPTER_PREVIEW_GENERATION: videoChapterPreviewPayloadSchema,
  VIDEO_STREAMING_OPTIMIZATION: videoStreamingOptimizationPayloadSchema,
  VIDEO_KEYFRAME_DISCOVERY: videoKeyframeDiscoveryPayloadSchema,
  VIDEO_KEYFRAME_GENERATION: videoKeyframeGenerationPayloadSchema,
  ARCHIVE_RESOLVE_ITEM: archiveResolveItemPayloadSchema,
  ARCHIVE_IMPORT: archiveImportPayloadSchema,
  ARCHIVE_MAINTENANCE: archiveMaintenancePayloadSchema,
  ARCHIVE_INTAKE_RETENTION_CLEANUP: emptyJobPayloadSchema,
  SCAN_RUN_RETENTION_CLEANUP: emptyJobPayloadSchema,
  TRIGGER_LOG_RETENTION_CLEANUP: emptyJobPayloadSchema,
  DERIVED_MEDIA_GC: derivedMediaGcPayloadSchema
} satisfies Record<JobType, z.ZodType>

export function parseJobPayload(type: JobType, payload: unknown) {
  return JOB_PAYLOAD_SCHEMAS[type].parse(payload)
}
