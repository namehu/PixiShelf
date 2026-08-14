import { z } from 'zod'
import { JOB_DEFINITION_VERSION, type JobType } from './job-types.js'

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

export const pendingReplacePayloadSchema = z.object({
  batchId: z.string().min(1),
  relativePath: relativePathSchema,
  mode: z.enum(['BATCH', 'RESTORE', 'CLEANUP'])
})

export const targetImagePayloadSchema = z.object({
  imageId: z.number().int().positive(),
  relativePath: relativePathSchema
})

export const videoMediaProbePayloadSchema = z.object({
  force: z.boolean().default(false),
  enqueueMissingPosters: z.boolean().default(true)
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

export const derivedMediaGcPayloadSchema = z.object({
  entryIds: z.array(z.string().min(1)).max(1_000).optional(),
  dryRun: z.boolean().default(false)
})

export const JOB_PAYLOAD_SCHEMAS = {
  SCAN: emptyJobPayloadSchema,
  LOCAL_DIRECTORY_IMPORT: emptyJobPayloadSchema,
  MIGRATION: emptyJobPayloadSchema,
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
  ARCHIVE_IMPORT: archiveImportPayloadSchema,
  SCAN_RUN_RETENTION_CLEANUP: emptyJobPayloadSchema,
  TRIGGER_LOG_RETENTION_CLEANUP: emptyJobPayloadSchema,
  DERIVED_MEDIA_GC: derivedMediaGcPayloadSchema
} satisfies Record<JobType, z.ZodType>

export function parseJobPayload(type: JobType, payload: unknown) {
  return JOB_PAYLOAD_SCHEMAS[type].parse(payload)
}
