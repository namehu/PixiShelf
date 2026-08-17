import { JOB_DEFINITION_VERSION, type WorkerCapability } from '@pixishelf/job-contracts'

export const PRODUCTION_WORKER_CAPABILITIES = [
  { jobType: 'ARCHIVE_IMPORT', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'DERIVED_MEDIA_GC', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'LOCAL_DIRECTORY_IMPORT', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'MEDIA_DERIVED_TAG_SYNC', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'MIGRATION', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'PENDING_REPLACE', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'REFILL_META_SOURCE', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'SCAN', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'SCAN_RUN_RETENTION_CLEANUP', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'TRIGGER_LOG_RETENTION_CLEANUP', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'VIDEO_CHAPTER_PREVIEW_GENERATION', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'VIDEO_KEYFRAME_DISCOVERY', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'VIDEO_KEYFRAME_GENERATION', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'VIDEO_MEDIA_PROBE', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'VIDEO_POSTER_GENERATION', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'VIDEO_STREAMING_OPTIMIZATION', definitionVersions: [JOB_DEFINITION_VERSION] },
  { jobType: 'WEBP_ANIMATION_SCAN', definitionVersions: [JOB_DEFINITION_VERSION] }
] as const satisfies readonly WorkerCapability[]

export function canonicalWorkerCapabilities(
  capabilities: readonly { jobType: string; definitionVersions: readonly number[] }[]
) {
  return capabilities
    .map((capability) => ({
      jobType: capability.jobType,
      definitionVersions: [...capability.definitionVersions].sort((left, right) => left - right)
    }))
    .sort((left, right) => left.jobType.localeCompare(right.jobType))
}

export function assertProductionWorkerCapabilities(
  capabilities: readonly { jobType: string; definitionVersions: readonly number[] }[]
): void {
  const actual = canonicalWorkerCapabilities(capabilities)
  const expected = canonicalWorkerCapabilities(PRODUCTION_WORKER_CAPABILITIES)
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error('Production Worker capability inventory drifted from the 17-item v1 release')
  }
}
