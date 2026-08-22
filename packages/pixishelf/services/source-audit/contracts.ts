import { jobStatusSchema } from '@pixishelf/job-contracts'
import { z } from 'zod'

export const SOURCE_AUDIT_CLASSIFICATION_VALUES = ['NEW', 'CHANGED', 'MISSING', 'INVALID', 'IDENTITY_CONFLICT'] as const

export const sourceAuditClassificationSchema = z.enum(SOURCE_AUDIT_CLASSIFICATION_VALUES)
export const sourceAuditStatusSchema = jobStatusSchema

export const sourceAuditAvailabilityReasonSchema = z.enum([
  'AUDIT_ACTIVE',
  'CUTOVER_DISABLED',
  'DISPATCH_DISABLED',
  'SCAN_ROOT_NOT_CONFIGURED',
  'SCAN_ROOT_UNAVAILABLE',
  'INVENTORY_NOT_READY',
  'WORKER_NOT_READY',
  'SCAN_BUSY'
])

export const sourceAuditAvailabilitySchema = z
  .object({
    available: z.boolean(),
    reason: sourceAuditAvailabilityReasonSchema.nullable(),
    activeAudit: z
      .object({
        auditRunId: z.string().min(1),
        jobId: z.string().min(1),
        status: sourceAuditStatusSchema
      })
      .strict()
      .nullable()
  })
  .strict()

export const startSourceAuditInputSchema = z
  .object({
    requestId: z.string().uuid()
  })
  .strict()

export const startSourceAuditResultSchema = z
  .object({
    jobId: z.string().min(1),
    auditRunId: z.string().min(1),
    status: sourceAuditStatusSchema,
    reused: z.boolean()
  })
  .strict()

export const sourceAuditRunIdInputSchema = z
  .object({
    auditRunId: z.string().trim().min(1).max(128)
  })
  .strict()

export const sourceAuditActionRequiredReasonSchema = z.enum([
  'EMPTY_SOURCE',
  'SOURCE_CHANGED',
  'INVENTORY_NOT_READY',
  'SAFETY_LIMIT_EXCEEDED',
  'PRECONDITION_FAILED',
  'EXECUTION_FAILED',
  'CANCELLED'
])

const nonnegativeCountSchema = z.number().int().nonnegative()

export const sourceAuditSummarySchema = z
  .object({
    id: z.string().min(1),
    jobId: z.string().min(1),
    status: sourceAuditStatusSchema,
    verification: z.literal('FAST'),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    finishedAt: z.string().datetime({ offset: true }).nullable(),
    completed: z.boolean(),
    actionRequiredReason: sourceAuditActionRequiredReasonSchema.nullable(),
    counts: z
      .object({
        new: nonnegativeCountSchema,
        changed: nonnegativeCountSchema,
        missing: nonnegativeCountSchema,
        invalid: nonnegativeCountSchema,
        identityConflict: nonnegativeCountSchema,
        unchanged: nonnegativeCountSchema
      })
      .strict(),
    work: z
      .object({
        walked: nonnegativeCountSchema,
        candidates: nonnegativeCountSchema,
        hashed: nonnegativeCountSchema,
        changed: nonnegativeCountSchema,
        discoveryDurationMs: nonnegativeCountSchema,
        hashDurationMs: nonnegativeCountSchema
      })
      .strict()
  })
  .strict()

export const listSourceAuditItemsInputSchema = sourceAuditRunIdInputSchema
  .extend({
    classification: sourceAuditClassificationSchema.optional(),
    cursor: z.string().min(1).max(512).optional(),
    limit: z.number().int().min(1).max(100).default(50)
  })
  .strict()

export const sourceAuditItemSchema = z
  .object({
    id: z.string().min(1),
    classification: sourceAuditClassificationSchema,
    externalId: z.string().nullable(),
    title: z.string().nullable(),
    artistName: z.string().nullable(),
    metadataRelativePath: z.string().min(1),
    artwork: z.object({ id: z.number().int().positive(), title: z.string() }).strict().nullable(),
    expectedExternalId: z.string().nullable(),
    observedExternalId: z.string().nullable(),
    reasonCode: z.string().nullable(),
    reasonSummary: z.string().nullable(),
    eligibleAction: z.enum(['IMPORT', 'SYNC']).nullable(),
    apply: z.discriminatedUnion('state', [
      z.object({ state: z.literal('ELIGIBLE'), action: z.enum(['IMPORT', 'SYNC']) }).strict(),
      z
        .object({
          state: z.enum(['NOT_APPLICABLE', 'IN_PROGRESS', 'ALREADY_APPLIED', 'REQUIRES_NEW_AUDIT']),
          action: z.null()
        })
        .strict()
    ]),
    latestApplyResult: z
      .object({
        operationId: z.string().min(1),
        action: z.enum(['IMPORT', 'SYNC']),
        result: z.enum(['APPLIED', 'SKIPPED', 'STALE', 'CONFLICT', 'FAILED']),
        code: z.string().nullable(),
        summary: z.string().nullable(),
        retryable: z.boolean(),
        finishedAt: z.string().datetime({ offset: true }).nullable()
      })
      .strict()
      .nullable()
  })
  .strict()

export const sourceAuditItemPageSchema = z
  .object({
    items: z.array(sourceAuditItemSchema),
    nextCursor: z.string().nullable()
  })
  .strict()

export const startSourceAuditApplyInputSchema = z
  .object({
    auditRunId: z.string().trim().min(1).max(128),
    itemIds: z
      .array(z.string().trim().min(1).max(128))
      .min(1)
      .max(50)
      .refine((values) => new Set(values).size === values.length, 'Expected unique source audit item ids'),
    idempotencyKey: z.string().uuid()
  })
  .strict()

export const sourceAuditApplyBlockedReasonSchema = z.enum([
  'APPLY_ACTIVE',
  'SCAN_BUSY',
  'AUDIT_NOT_COMPLETE',
  'ITEMS_NOT_ELIGIBLE',
  'CUTOVER_DISABLED',
  'DISPATCH_DISABLED',
  'SCAN_ROOT_NOT_CONFIGURED',
  'SOURCE_ROOT_UNAVAILABLE',
  'INVENTORY_NOT_READY',
  'WORKER_NOT_READY',
  'IDEMPOTENCY_CONFLICT'
])

export const sourceAuditApplyOperationRefSchema = z
  .object({
    operationId: z.string().min(1),
    jobId: z.string().min(1),
    status: sourceAuditStatusSchema
  })
  .strict()

export const startSourceAuditApplyResultSchema = z.discriminatedUnion('outcome', [
  sourceAuditApplyOperationRefSchema.extend({ outcome: z.literal('ACCEPTED'), reused: z.boolean() }).strict(),
  z
    .object({
      outcome: z.literal('BLOCKED'),
      reason: sourceAuditApplyBlockedReasonSchema,
      activeOperationId: z.string().min(1).nullable()
    })
    .strict()
])

export const sourceAuditApplyOverviewInputSchema = sourceAuditRunIdInputSchema

export const sourceAuditApplyOverviewSchema = z
  .object({
    activeOperation: sourceAuditApplyOperationRefSchema.nullable(),
    latestOperation: sourceAuditApplyOperationRefSchema.nullable()
  })
  .strict()

export const sourceAuditApplyOperationInputSchema = z
  .object({ operationId: z.string().trim().min(1).max(128) })
  .strict()

export const sourceAuditApplyStageSchema = z.enum([
  'QUEUED',
  'VERIFYING',
  'APPLYING',
  'FINALIZING',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
])

export const sourceAuditApplyItemStateSchema = z.enum([
  'PENDING',
  'PROCESSING',
  'APPLIED',
  'SKIPPED',
  'STALE',
  'CONFLICT',
  'FAILED'
])

export const sourceAuditApplyOperationItemSchema = z
  .object({
    id: z.string().min(1),
    auditItemId: z.string().min(1),
    classification: z.enum(['NEW', 'CHANGED']),
    action: z.enum(['IMPORT', 'SYNC']),
    state: sourceAuditApplyItemStateSchema,
    externalId: z.string().nullable(),
    title: z.string().nullable(),
    artistName: z.string().nullable(),
    metadataRelativePath: z.string().min(1),
    artwork: z.object({ id: z.number().int().positive(), title: z.string() }).strict().nullable(),
    code: z.string().nullable(),
    summary: z.string().nullable(),
    retryable: z.boolean(),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    finishedAt: z.string().datetime({ offset: true }).nullable()
  })
  .strict()

export const sourceAuditApplyOperationSchema = z
  .object({
    id: z.string().min(1),
    auditRunId: z.string().min(1),
    jobId: z.string().min(1),
    status: sourceAuditStatusSchema,
    terminal: z.boolean(),
    resultComplete: z.boolean(),
    progress: z.number().int().min(0).max(100),
    stage: sourceAuditApplyStageSchema,
    requested: z
      .object({ total: nonnegativeCountSchema, new: nonnegativeCountSchema, changed: nonnegativeCountSchema })
      .strict(),
    counts: z
      .object({
        pending: nonnegativeCountSchema,
        processing: nonnegativeCountSchema,
        applied: nonnegativeCountSchema,
        skipped: nonnegativeCountSchema,
        stale: nonnegativeCountSchema,
        conflict: nonnegativeCountSchema,
        failed: nonnegativeCountSchema
      })
      .strict(),
    createdAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    finishedAt: z.string().datetime({ offset: true }).nullable(),
    items: z.array(sourceAuditApplyOperationItemSchema).max(50)
  })
  .strict()

export type SourceAuditAvailability = z.infer<typeof sourceAuditAvailabilitySchema>
export type SourceAuditClassification = z.infer<typeof sourceAuditClassificationSchema>
export type SourceAuditStatus = z.infer<typeof sourceAuditStatusSchema>
export type SourceAuditSummary = z.infer<typeof sourceAuditSummarySchema>
export type SourceAuditItemPage = z.infer<typeof sourceAuditItemPageSchema>
export type StartSourceAuditApplyResult = z.infer<typeof startSourceAuditApplyResultSchema>
export type SourceAuditApplyOperation = z.infer<typeof sourceAuditApplyOperationSchema>
