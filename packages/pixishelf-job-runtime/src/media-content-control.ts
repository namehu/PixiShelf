import type { QueueSqlExecutor } from './queue-repository.ts'

export const MEDIA_CONTENT_RECOVERY_REQUIRED = 'MEDIA_CONTENT_RECOVERY_REQUIRED'
export const MEDIA_CONTENT_CANCELLATION_MESSAGE = '存在未解决的媒体写入，取消未完成，需先恢复处理'
export const MEDIA_CONTENT_RECOVERY_PAUSE_MESSAGE = '取消未完成，需恢复处理'

export async function lockContentControlJob(transaction: QueueSqlExecutor, jobId: string) {
  // The same order as a worker finalizer prevents a new declaration between the check and control update.
  await transaction.$queryRawUnsafe(
    `SELECT "resourceKey" FROM "job_resource_leases" WHERE "ownerJobId" = $1 FOR UPDATE`,
    jobId
  )
  await transaction.$queryRawUnsafe(`SELECT "id" FROM "system_jobs" WHERE "id" = $1 FOR UPDATE`, jobId)
}

export async function hasBlockingMediaContentCancellation(transaction: QueueSqlExecutor, jobId: string) {
  await lockContentControlJob(transaction, jobId)
  const rows = await transaction.$queryRawUnsafe<Array<{ blocked: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM "MediaContentPathWrite" AS claim
       JOIN "system_jobs" AS job ON job."id" = claim."jobId"
       WHERE job."id" = $1 AND claim."status" IN ('ACTIVE', 'READY', 'RECOVERY_REQUIRED')
         AND (job."status" NOT IN ('RUNNING', 'PAUSING') OR job."leaseToken" IS NULL
           OR claim."executionToken" IS DISTINCT FROM job."leaseToken"::text
           OR claim."executionAttempt" IS DISTINCT FROM job."attempt")
     ) AS blocked`,
    jobId
  )
  return rows[0]?.blocked === true
}

/** Caller already holds the resource/job fence; this query never changes or releases a claim. */
export async function hasUnresolvedMediaContentWrites(transaction: QueueSqlExecutor, jobId: string) {
  const rows = await transaction.$queryRawUnsafe<Array<{ unresolved: boolean }>>(
    `SELECT EXISTS (SELECT 1 FROM "MediaContentPathWrite"
       WHERE "jobId" = $1 AND "status" IN ('ACTIVE', 'READY', 'RECOVERY_REQUIRED')) AS unresolved`,
    jobId
  )
  return rows[0]?.unresolved === true
}

export async function hasBlockingMediaContentRecoveryResume(transaction: QueueSqlExecutor, jobId: string) {
  await lockContentControlJob(transaction, jobId)
  const rows = await transaction.$queryRawUnsafe<Array<{ blocked: boolean }>>(
    `SELECT EXISTS (
       SELECT 1 FROM "system_jobs" AS job
       WHERE job."id" = $1 AND job."status" = 'PAUSED' AND job."errorCode" = $2
         AND job."type" IN ('PENDING_REPLACE', 'MIGRATION', 'VIDEO_STREAMING_OPTIMIZATION', 'ARCHIVE_MAINTENANCE')
         AND EXISTS (SELECT 1 FROM "MediaContentPathWrite" AS claim
           WHERE claim."jobId" = job."id" AND claim."status" IN ('ACTIVE', 'READY', 'RECOVERY_REQUIRED'))
         AND NOT EXISTS (SELECT 1 FROM "MediaContentRecoveryGrant" AS grant_record
           WHERE grant_record."jobId" = job."id" AND grant_record."status" = 'ACTIVE'
             AND grant_record."expectedAttempt" = job."attempt" AND grant_record."targetAttempt" = job."attempt" + 1)
     ) AS blocked`,
    jobId,
    MEDIA_CONTENT_RECOVERY_REQUIRED
  )
  return rows[0]?.blocked === true
}
