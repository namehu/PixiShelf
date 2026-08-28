import {
  ARCHIVE_IMPORT_DEFINITION_VERSION,
  executionLaneForJobType,
  JOB_DEFINITION_VERSION,
  SCAN_AUDIT_APPLY_DEFINITION_VERSION,
  SCAN_DEFINITION_VERSION,
  type JobType,
  type WorkerCapability
} from '@pixishelf/job-contracts'

const PRODUCTION_JOB_TYPES = [
  'ARCHIVE_DEFAULT_TAG_BACKFILL',
  'ARCHIVE_IMPORT',
  'ARCHIVE_INTAKE_RETENTION_CLEANUP',
  'ARCHIVE_MAINTENANCE',
  'ARCHIVE_RESOLVE_ITEM',
  'DERIVED_MEDIA_GC',
  'LOCAL_DIRECTORY_IMPORT',
  'MEDIA_DERIVED_TAG_SYNC',
  'MIGRATION',
  'PENDING_REPLACE',
  'PIXIV_AI_DERIVED_TAG_SYNC',
  'PIXIV_ARTIST_ENRICHMENT',
  'PIXIV_ARTWORK_ENRICHMENT',
  'PIXIV_SERIES_RECONCILIATION',
  'PIXIV_TAG_ENRICHMENT',
  'REFILL_META_SOURCE',
  'SCAN',
  'SCAN_RUN_RETENTION_CLEANUP',
  'TRIGGER_LOG_RETENTION_CLEANUP',
  'VIDEO_CHAPTER_PREVIEW_GENERATION',
  'VIDEO_KEYFRAME_DISCOVERY',
  'VIDEO_KEYFRAME_GENERATION',
  'VIDEO_MEDIA_PROBE',
  'VIDEO_POSTER_GENERATION',
  'VIDEO_STREAMING_OPTIMIZATION',
  'WEBP_ANIMATION_SCAN'
] as const satisfies readonly JobType[]

export const PRODUCTION_WORKER_CAPABILITIES = PRODUCTION_JOB_TYPES.map((jobType) => ({
  jobType,
  executionLane: executionLaneForJobType(jobType),
  definitionVersions:
    jobType === 'SCAN'
      ? [JOB_DEFINITION_VERSION, SCAN_DEFINITION_VERSION, SCAN_AUDIT_APPLY_DEFINITION_VERSION]
      : jobType === 'ARCHIVE_IMPORT'
        ? [JOB_DEFINITION_VERSION, ARCHIVE_IMPORT_DEFINITION_VERSION]
        : [JOB_DEFINITION_VERSION]
})) satisfies readonly WorkerCapability[]

export function canonicalWorkerCapabilities(
  capabilities: readonly { jobType: string; executionLane: string; definitionVersions: readonly number[] }[]
) {
  return capabilities
    .map((capability) => ({
      jobType: capability.jobType,
      executionLane: capability.executionLane,
      definitionVersions: [...capability.definitionVersions].sort((left, right) => left - right)
    }))
    .sort(
      (left, right) =>
        left.jobType.localeCompare(right.jobType) || left.executionLane.localeCompare(right.executionLane)
    )
}

export function assertProductionWorkerCapabilities(
  capabilities: readonly { jobType: string; executionLane: string; definitionVersions: readonly number[] }[]
): void {
  const actual = canonicalWorkerCapabilities(capabilities)
  const expected = canonicalWorkerCapabilities(PRODUCTION_WORKER_CAPABILITIES)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Production Worker capability inventory drifted from the 26-job/29-version dual-lane release')
  }
}
