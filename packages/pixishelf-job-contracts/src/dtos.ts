import { z } from 'zod'
import { jsonValueSchema } from './payloads.ts'
import { jobProgressDataSchema } from './job-progress-data.ts'
import {
  executionLaneSchema,
  jobEventLevelSchema,
  jobEventTypeSchema,
  jobSkipReasonSchema,
  jobStatusSchema,
  jobTriggerSourceSchema,
  jobTypeSchema
} from './job-types.ts'

export const isoDateTimeSchema = z.string().datetime({ offset: true })
export const bigintStringSchema = z.string().regex(/^(0|[1-9]\d*)$/, 'Expected an unsigned base-10 integer string')

export const jobDtoSchema = z.object({
  id: z.string().min(1),
  type: jobTypeSchema,
  executionLane: executionLaneSchema,
  definitionVersion: z.number().int().nonnegative(),
  status: jobStatusSchema,
  triggerSource: jobTriggerSourceSchema,
  requestedByUserId: z.string().nullable(),
  scheduledTaskId: z.string().nullable(),
  scheduledForDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable(),
  idempotencyKey: z.string().nullable(),
  payload: jsonValueSchema.nullable(),
  progress: z.number().int().min(0).max(100),
  progressData: jobProgressDataSchema.nullable(),
  stage: z.string().nullable(),
  message: z.string().nullable(),
  result: jsonValueSchema.nullable(),
  errorCode: z.string().nullable(),
  error: z.string().nullable(),
  skipReason: jobSkipReasonSchema.nullable(),
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  parentJobId: z.string().nullable(),
  queuePriority: z.number().int(),
  effectivePriority: z.number().int(),
  availableAt: isoDateTimeSchema.nullable(),
  deadlineAt: isoDateTimeSchema.nullable(),
  workerId: z.string().nullable(),
  leaseToken: z.string().uuid().nullable(),
  leaseExpiresAt: isoDateTimeSchema.nullable(),
  heartbeatAt: isoDateTimeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
  updatedAt: isoDateTimeSchema
})
export type JobDto = z.infer<typeof jobDtoSchema>

export const jobEventDtoSchema = z.object({
  id: bigintStringSchema,
  jobId: z.string().min(1),
  type: jobEventTypeSchema,
  level: jobEventLevelSchema,
  attempt: z.number().int().nonnegative(),
  workerId: z.string().nullable(),
  stage: z.string().nullable(),
  progress: z.number().int().min(0).max(100).nullable(),
  message: z.string().nullable(),
  data: jsonValueSchema.nullable(),
  createdAt: isoDateTimeSchema
})
export type JobEventDto = z.infer<typeof jobEventDtoSchema>

export const jobLiveSummarySchema = z.object({
  id: z.string().min(1),
  type: jobTypeSchema,
  executionLane: executionLaneSchema,
  status: jobStatusSchema,
  progress: z.number().int().min(0).max(100),
  progressData: jobProgressDataSchema.nullable(),
  stage: z.string().nullable(),
  message: z.string().nullable(),
  errorCode: z.string().nullable(),
  attempt: z.number().int().nonnegative(),
  parentJobId: z.string().nullable(),
  heartbeatAt: isoDateTimeSchema.nullable(),
  startedAt: isoDateTimeSchema.nullable(),
  finishedAt: isoDateTimeSchema.nullable(),
  updatedAt: isoDateTimeSchema
})
export type JobLiveSummary = z.infer<typeof jobLiveSummarySchema>

export const jobEventStreamItemSchema = z.object({
  event: jobEventDtoSchema,
  job: jobLiveSummarySchema
})
export type JobEventStreamItem = z.infer<typeof jobEventStreamItemSchema>

export const jobEventStreamBatchSchema = z.object({
  version: z.literal(1),
  cursor: bigintStringSchema,
  items: z.array(jobEventStreamItemSchema).max(200)
})
export type JobEventStreamBatch = z.infer<typeof jobEventStreamBatchSchema>

export const WORKER_PRESENCE_STATUS_VALUES = ['STARTING', 'READY', 'DEGRADED', 'STOPPING'] as const
export const workerPresenceStatusSchema = z.enum(WORKER_PRESENCE_STATUS_VALUES)
export type WorkerPresenceStatus = z.infer<typeof workerPresenceStatusSchema>

export const workerCapabilitySchema = z.object({
  jobType: jobTypeSchema,
  executionLane: executionLaneSchema,
  definitionVersions: z
    .array(z.number().int().nonnegative())
    .min(1)
    .max(20)
    .refine((versions) => new Set(versions).size === versions.length, 'Versions must be unique')
})
export type WorkerCapability = z.infer<typeof workerCapabilitySchema>

export const workerHealthDtoSchema = z.object({
  workerId: z.string().min(1).max(120),
  status: workerPresenceStatusSchema,
  serviceVersion: z.string().min(1).max(50),
  hostname: z.string().min(1).max(255),
  processId: z.number().int().positive(),
  capabilities: z.array(workerCapabilitySchema).max(100),
  startedAt: isoDateTimeSchema,
  heartbeatAt: isoDateTimeSchema,
  lastError: z.string().max(2048).nullable(),
  updatedAt: isoDateTimeSchema
})
export type WorkerHealthDto = z.infer<typeof workerHealthDtoSchema>
