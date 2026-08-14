import { z } from 'zod'

export const JOB_DEFINITION_VERSION = 1 as const

export const JOB_TYPE_VALUES = [
  'SCAN',
  'LOCAL_DIRECTORY_IMPORT',
  'MIGRATION',
  'PENDING_REPLACE',
  'REFILL_META_SOURCE',
  'MEDIA_DERIVED_TAG_SYNC',
  'WEBP_ANIMATION_SCAN',
  'VIDEO_MEDIA_PROBE',
  'VIDEO_POSTER_GENERATION',
  'VIDEO_CHAPTER_PREVIEW_GENERATION',
  'VIDEO_STREAMING_OPTIMIZATION',
  'VIDEO_KEYFRAME_DISCOVERY',
  'VIDEO_KEYFRAME_GENERATION',
  'ARCHIVE_IMPORT',
  'SCAN_RUN_RETENTION_CLEANUP',
  'TRIGGER_LOG_RETENTION_CLEANUP',
  'DERIVED_MEDIA_GC'
] as const

export const jobTypeSchema = z.enum(JOB_TYPE_VALUES)
export type JobType = z.infer<typeof jobTypeSchema>

export const JOB_TYPES = Object.freeze(
  Object.fromEntries(JOB_TYPE_VALUES.map((value) => [value, value])) as { [K in JobType]: K }
)

export const JOB_STATUS_VALUES = [
  'PENDING',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'RETRY_WAIT',
  'COMPLETED',
  'FAILED',
  'CANCELLED',
  'CANCELLING',
  'SKIPPED'
] as const

export const jobStatusSchema = z.enum(JOB_STATUS_VALUES)
export type JobStatus = z.infer<typeof jobStatusSchema>

export const ACTIVE_JOB_STATUSES = new Set<JobStatus>([
  'PENDING',
  'RUNNING',
  'PAUSING',
  'PAUSED',
  'RETRY_WAIT',
  'CANCELLING'
])

export const EXECUTING_JOB_STATUSES = new Set<JobStatus>(['RUNNING', 'PAUSING', 'CANCELLING'])
export const TERMINAL_JOB_STATUSES = new Set<JobStatus>(['COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED'])

export const JOB_TRIGGER_SOURCE_VALUES = ['MANUAL', 'SCHEDULE', 'SYSTEM', 'RETRY', 'LEGACY'] as const
export const jobTriggerSourceSchema = z.enum(JOB_TRIGGER_SOURCE_VALUES)
export type JobTriggerSource = z.infer<typeof jobTriggerSourceSchema>

export const JOB_SKIP_REASON_VALUES = [
  'WINDOW_EXPIRED',
  'DISABLED_BEFORE_START',
  'SUPERSEDED',
  'PRECONDITION_NOT_MET'
] as const
export const jobSkipReasonSchema = z.enum(JOB_SKIP_REASON_VALUES)
export type JobSkipReason = z.infer<typeof jobSkipReasonSchema>

export const JOB_EVENT_LEVEL_VALUES = ['INFO', 'WARN', 'ERROR'] as const
export const jobEventLevelSchema = z.enum(JOB_EVENT_LEVEL_VALUES)
export type JobEventLevel = z.infer<typeof jobEventLevelSchema>

export const JOB_EVENT_TYPE_VALUES = [
  'job.queued',
  'job.claimed',
  'job.started',
  'job.stage_changed',
  'job.progress',
  'job.retry_scheduled',
  'job.pause_requested',
  'job.paused',
  'job.cancel_requested',
  'job.cancelled',
  'job.completed',
  'job.failed',
  'job.skipped',
  'worker.lease_recovered',
  'gc.entry_deleted',
  'gc.entry_failed'
] as const
export const jobEventTypeSchema = z.enum(JOB_EVENT_TYPE_VALUES)
export type JobEventType = z.infer<typeof jobEventTypeSchema>

export const GC_ENTRY_STATUS_VALUES = ['PENDING', 'PROCESSING', 'DELETED', 'SKIPPED_REFERENCED', 'FAILED'] as const
export const gcEntryStatusSchema = z.enum(GC_ENTRY_STATUS_VALUES)
export type GcEntryStatus = z.infer<typeof gcEntryStatusSchema>
