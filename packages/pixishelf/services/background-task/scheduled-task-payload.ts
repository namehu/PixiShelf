import { jobTypeSchema, parseJobPayload, type JobType, type JsonValue } from '@pixishelf/job-contracts'

interface ScheduledTaskPayloadOptions {
  trigger: 'manual' | 'schedule'
  scheduleKey?: string
  taskConfig?: unknown
  chapterPreviewMode?: 'FULL' | 'INCREMENTAL'
}

export interface ScheduledTaskJobDefinition {
  type: JobType
  payload: JsonValue
}

export function buildScheduledTaskJobDefinition(
  taskType: string,
  options: ScheduledTaskPayloadOptions
): ScheduledTaskJobDefinition {
  const type = jobTypeSchema.parse(taskType)
  let candidate: unknown

  switch (type) {
    case 'TRIGGER_LOG_RETENTION_CLEANUP':
    case 'SCAN_RUN_RETENTION_CLEANUP':
    case 'WEBP_ANIMATION_SCAN':
      candidate = {}
      break
    case 'VIDEO_MEDIA_PROBE':
      candidate = { force: false, enqueueMissingPosters: true }
      break
    case 'DERIVED_MEDIA_GC':
      candidate =
        options.trigger === 'schedule' && options.scheduleKey !== 'derived_media_gc_reconciliation'
          ? { dryRun: false, reconcile: false }
          : { dryRun: true, reconcile: true }
      break
    case 'VIDEO_CHAPTER_PREVIEW_GENERATION':
      candidate = {
        mode: options.chapterPreviewMode ?? (options.trigger === 'schedule' ? 'INCREMENTAL' : 'FULL')
      }
      break
    case 'VIDEO_KEYFRAME_DISCOVERY':
      candidate = {
        trigger: options.trigger,
        force: false,
        previewOnly: options.trigger === 'manual',
        filter: options.taskConfig ?? {}
      }
      break
    default:
      throw new Error(`Unsupported scheduled task type: ${type}`)
  }

  return {
    type,
    payload: parseJobPayload(type, candidate) as JsonValue
  }
}
