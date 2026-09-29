import {
  ARCHIVE_IMPORT_DEFINITION_VERSION,
  JOB_DEFINITION_VERSION,
  archiveImportPayloadSchema,
  archiveImportV2PayloadSchema
} from '@pixishelf/job-contracts'
import { ArchiveError } from './errors'

export function archiveImportDefaultTagIdsForRetry(
  job: { definitionVersion: number; payload: unknown },
  archiveImportId: string
): number[] {
  let parsed: { archiveImportId: string; defaultTagIds: number[] } | null = null
  try {
    parsed =
      job.definitionVersion === JOB_DEFINITION_VERSION
        ? { ...archiveImportPayloadSchema.parse(job.payload), defaultTagIds: [] }
        : job.definitionVersion === ARCHIVE_IMPORT_DEFINITION_VERSION
          ? archiveImportV2PayloadSchema.parse(job.payload)
          : null
  } catch {
    throw invalidRetryPayload()
  }
  if (!parsed || parsed.archiveImportId !== archiveImportId) {
    throw invalidRetryPayload()
  }
  return parsed.defaultTagIds
}

function invalidRetryPayload() {
  return new ArchiveError('STATE_CONFLICT', '归档任务的执行定义或载荷绑定无效，不能重试')
}
