import { z } from 'zod'

export const JOB_DEFINITION_VERSION = 1 as const

// SCAN evolves independently so the other durable job contracts remain on v1.
export const SCAN_DEFINITION_VERSION = 2 as const

// AUDIT_APPLY is isolated from the Stage 3A SCAN@v2 release so an older Worker
// that advertised v2 cannot claim a write-capable task it only knows how to reject.
export const SCAN_AUDIT_APPLY_DEFINITION_VERSION = 3 as const

// ARCHIVE_IMPORT@v2 freezes system-configured default tags in the durable payload.
// Keeping it separate prevents an older v1 Worker from silently discarding the tags.
export const ARCHIVE_IMPORT_DEFINITION_VERSION = 2 as const

// All transactions that create or retire singleton SCAN work coordinate on
// this namespace plus PostgreSQL hashtext('SCAN').
export const SINGLETON_JOB_ADVISORY_LOCK_NAMESPACE = 80_432_028 as const

export const JOB_TYPE_VALUES = [
  'SCAN',
  'LOCAL_DIRECTORY_IMPORT',
  'MIGRATION',
  'PENDING_REPLACE',
  'REFILL_META_SOURCE',
  'MEDIA_DERIVED_TAG_SYNC',
  'PIXIV_AI_DERIVED_TAG_SYNC',
  'WEBP_ANIMATION_SCAN',
  'VIDEO_MEDIA_PROBE',
  'VIDEO_POSTER_GENERATION',
  'VIDEO_CHAPTER_PREVIEW_GENERATION',
  'VIDEO_STREAMING_OPTIMIZATION',
  'VIDEO_KEYFRAME_DISCOVERY',
  'VIDEO_KEYFRAME_GENERATION',
  'ARCHIVE_RESOLVE_ITEM',
  'ARCHIVE_IMPORT',
  'ARCHIVE_MAINTENANCE',
  'ARCHIVE_INTAKE_RETENTION_CLEANUP',
  'SCAN_RUN_RETENTION_CLEANUP',
  'TRIGGER_LOG_RETENTION_CLEANUP',
  'DERIVED_MEDIA_GC',
  'PIXIV_ARTWORK_ENRICHMENT',
  'PIXIV_ARTIST_ENRICHMENT',
  'PIXIV_SERIES_RECONCILIATION',
  'PIXIV_TAG_ENRICHMENT'
] as const

export const jobTypeSchema = z.enum(JOB_TYPE_VALUES)
export type JobType = z.infer<typeof jobTypeSchema>

export const EXECUTION_LANE_VALUES = ['ARCHIVE_RESOLVE', 'BACKGROUND_WRITER'] as const
export const executionLaneSchema = z.enum(EXECUTION_LANE_VALUES)
export type ExecutionLane = z.infer<typeof executionLaneSchema>

export const EXECUTION_LANES = Object.freeze({
  ARCHIVE_RESOLVE: 'ARCHIVE_RESOLVE',
  BACKGROUND_WRITER: 'BACKGROUND_WRITER'
} satisfies { [K in ExecutionLane]: K })

/**
 * A job type has exactly one lane. Queue producers derive this value instead of
 * accepting it from callers, so an I/O-only resolver cannot be promoted into
 * the serialized writer lane (or vice versa) by payload input.
 */
export const JOB_EXECUTION_LANE = Object.freeze(
  Object.fromEntries(
    JOB_TYPE_VALUES.map((jobType) => [
      jobType,
      jobType === 'ARCHIVE_RESOLVE_ITEM' ? EXECUTION_LANES.ARCHIVE_RESOLVE : EXECUTION_LANES.BACKGROUND_WRITER
    ])
  ) as { [K in JobType]: ExecutionLane }
)

export function executionLaneForJobType(jobType: JobType): ExecutionLane {
  return JOB_EXECUTION_LANE[jobType]
}

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
