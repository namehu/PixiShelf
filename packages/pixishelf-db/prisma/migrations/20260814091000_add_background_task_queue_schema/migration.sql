-- Keep the structural cutover atomic even if a later DDL statement fails.
BEGIN;

-- The first statement inside the transaction is deliberately read-only. A failed
-- audit must stop the migration before any table, column, index, constraint, or
-- data changes. This guard is defense in depth, not a concurrent-writer barrier:
-- the deployment runbook must stop every old writer before this migration starts.
DO $$
DECLARE
    blocking_details TEXT;
BEGIN
    SELECT string_agg(format('%s=%s', category, row_count), ', ' ORDER BY category)
      INTO blocking_details
      FROM (
        SELECT 'archive_import_items' AS category, count(*)::BIGINT AS row_count
          FROM "archive_import_items"
         WHERE "status"::TEXT = 'DOWNLOADING'
        HAVING count(*) > 0
        UNION ALL
        SELECT 'archive_imports', count(*)::BIGINT
          FROM "archive_imports"
         WHERE "status"::TEXT IN ('PENDING', 'RUNNING', 'PAUSED', 'CANCELLING')
        HAVING count(*) > 0
        UNION ALL
        SELECT 'archive_lifecycle', count(*)::BIGINT
          FROM "Artwork"
         WHERE "archiveLifecycleState"::TEXT IN ('TRASHING', 'RESTORING')
        HAVING count(*) > 0
        UNION ALL
        SELECT 'chapter_previews', count(*)::BIGINT
          FROM "MediaChapterPreview"
         WHERE "status"::TEXT = 'GENERATING'
        HAVING count(*) > 0
        UNION ALL
        SELECT 'keyframe_frames', count(*)::BIGINT
          FROM "MediaVideoKeyframe"
         WHERE "status"::TEXT = 'GENERATING'
        HAVING count(*) > 0
        UNION ALL
        SELECT 'keyframe_staging_sets', count(*)::BIGINT
          FROM "MediaVideoKeyframeSet" AS keyframe_set
          LEFT JOIN "system_jobs" AS linked_job
            ON linked_job."id" = keyframe_set."systemJobId"
         WHERE keyframe_set."status"::TEXT = 'STAGING'
           AND (
             keyframe_set."systemJobId" IS NULL
             OR linked_job."id" IS NULL
             OR linked_job."status"::TEXT NOT IN ('COMPLETED', 'FAILED', 'CANCELLED', 'SKIPPED')
           )
        HAVING count(*) > 0
        UNION ALL
        SELECT 'pending_replace_batches', count(*)::BIGINT
          FROM "pending_replace_batches"
         WHERE "status"::TEXT IN ('RUNNING', 'CANCELLING')
        HAVING count(*) > 0
        UNION ALL
        SELECT 'pending_replace_items', count(*)::BIGINT
          FROM "pending_replace_items"
         WHERE "status"::TEXT IN (
           'STAGING',
           'BACKING_UP',
           'SWAPPING',
           'COMMITTING',
           'ROLLING_BACK',
           'RESTORING',
           'RESTORE_SWAPPING'
         )
        HAVING count(*) > 0
        UNION ALL
        SELECT 'scan_runs', count(*)::BIGINT
          FROM "scan_runs"
         WHERE "status"::TEXT = 'RUNNING'
        HAVING count(*) > 0
        UNION ALL
        SELECT 'system_jobs', count(*)::BIGINT
          FROM "system_jobs"
         WHERE "status"::TEXT IN ('PENDING', 'RUNNING', 'PAUSING', 'PAUSED', 'CANCELLING', 'RETRY_WAIT')
        HAVING count(*) > 0
        UNION ALL
        SELECT 'video_posters', count(*)::BIGINT
          FROM "MediaVideoMetadata"
         WHERE "posterStatus"::TEXT = 'GENERATING'
        HAVING count(*) > 0
        UNION ALL
        SELECT 'video_probes', count(*)::BIGINT
          FROM "MediaVideoMetadata"
         WHERE "probeStatus"::TEXT = 'PROBING'
        HAVING count(*) > 0
      ) AS blockers;

    IF blocking_details IS NOT NULL THEN
        RAISE EXCEPTION
          'background task cutover audit failed; finish or recover active work before upgrading: %',
          blocking_details;
    END IF;
END
$$;

ALTER TABLE "system_jobs"
    ALTER COLUMN "type" TYPE VARCHAR(80),
    ALTER COLUMN "availableAt" SET DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "definitionVersion" INTEGER NOT NULL DEFAULT 1,
    ADD COLUMN "triggerSource" "JobTriggerSource" NOT NULL DEFAULT 'SYSTEM',
    ADD COLUMN "requestedByUserId" TEXT,
    ADD COLUMN "scheduledTaskId" TEXT,
    ADD COLUMN "scheduledForDate" VARCHAR(10),
    ADD COLUMN "idempotencyKey" VARCHAR(180),
    ADD COLUMN "payload" JSONB,
    ADD COLUMN "effectivePriority" INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN "deadlineAt" TIMESTAMP(3),
    ADD COLUMN "workerId" VARCHAR(120),
    ADD COLUMN "leaseToken" UUID,
    ADD COLUMN "leaseExpiresAt" TIMESTAMP(3),
    ADD COLUMN "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    ADD COLUMN "stage" VARCHAR(80),
    ADD COLUMN "errorCode" VARCHAR(80),
    ADD COLUMN "skipReason" "JobSkipReason",
    ADD COLUMN "skippedAt" TIMESTAMP(3),
    ADD COLUMN "lastAttemptStartedAt" TIMESTAMP(3),
    ADD COLUMN "cancelRequestedAt" TIMESTAMP(3),
    ADD COLUMN "pauseRequestedAt" TIMESTAMP(3);

ALTER TABLE "scheduled_tasks"
    ALTER COLUMN "type" TYPE VARCHAR(80),
    ADD COLUMN "lastMaterializedAt" TIMESTAMP(3),
    ADD COLUMN "lastMaterializedDate" VARCHAR(10);

-- The guard guarantees every existing job is terminal. Preserve those rows as
-- query-only history and make them permanently ineligible for the new worker.
UPDATE "system_jobs"
   SET "definitionVersion" = 0,
       "triggerSource" = 'LEGACY',
       "effectivePriority" = "queuePriority",
       "availableAt" = COALESCE("availableAt", "createdAt", CURRENT_TIMESTAMP),
       "maxAttempts" = GREATEST(3, "attempt");

UPDATE "scheduled_tasks"
   SET "lastMaterializedAt" = "lastTriggeredAt",
       "lastMaterializedDate" = "lastTriggeredDate";

CREATE TABLE "system_job_events" (
    "id" BIGSERIAL NOT NULL,
    "jobId" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "level" "JobEventLevel" NOT NULL DEFAULT 'INFO',
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "workerId" VARCHAR(120),
    "stage" VARCHAR(80),
    "progress" INTEGER,
    "message" TEXT,
    "data" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_job_events_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "system_job_events_progress_check"
      CHECK ("progress" IS NULL OR "progress" BETWEEN 0 AND 100)
);

CREATE TABLE "job_resource_leases" (
    "resourceKey" VARCHAR(180) NOT NULL,
    "ownerJobId" TEXT NOT NULL,
    "workerId" VARCHAR(120) NOT NULL,
    "leaseToken" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "heartbeatAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "job_resource_leases_pkey" PRIMARY KEY ("resourceKey")
);

CREATE TABLE "derived_media_gc_entries" (
    "id" TEXT NOT NULL,
    "mediaKind" VARCHAR(50) NOT NULL,
    "relativePath" TEXT NOT NULL,
    "referenceType" VARCHAR(50),
    "referenceId" VARCHAR(120),
    "reason" VARCHAR(80) NOT NULL,
    "status" "GcEntryStatus" NOT NULL DEFAULT 'PENDING',
    "notBefore" TIMESTAMP(3) NOT NULL,
    "attempt" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lastSystemJobId" TEXT,
    "error" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "derived_media_gc_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "derived_media_gc_entries_attempt_check" CHECK ("attempt" >= 0),
    CONSTRAINT "derived_media_gc_entries_max_attempts_check" CHECK ("maxAttempts" >= 1)
);

ALTER TABLE "system_jobs"
    ADD CONSTRAINT "system_jobs_progress_check" CHECK ("progress" BETWEEN 0 AND 100) NOT VALID,
    ADD CONSTRAINT "system_jobs_attempt_check" CHECK ("attempt" >= 0) NOT VALID,
    ADD CONSTRAINT "system_jobs_max_attempts_check" CHECK ("maxAttempts" >= 1) NOT VALID,
    ADD CONSTRAINT "system_jobs_definition_version_check" CHECK ("definitionVersion" >= 0) NOT VALID;

CREATE UNIQUE INDEX "system_jobs_idempotencyKey_key"
    ON "system_jobs"("idempotencyKey");
CREATE UNIQUE INDEX "system_jobs_scheduledTaskId_scheduledForDate_key"
    ON "system_jobs"("scheduledTaskId", "scheduledForDate");
CREATE INDEX "system_jobs_status_effectivePriority_availableAt_createdAt_idx"
    ON "system_jobs"("status", "effectivePriority", "availableAt", "createdAt");
CREATE INDEX "system_jobs_status_deadlineAt_idx"
    ON "system_jobs"("status", "deadlineAt");
CREATE INDEX "system_jobs_status_leaseExpiresAt_idx"
    ON "system_jobs"("status", "leaseExpiresAt");
CREATE INDEX "system_jobs_scheduledTaskId_createdAt_idx"
    ON "system_jobs"("scheduledTaskId", "createdAt");

CREATE INDEX "system_job_events_jobId_id_idx"
    ON "system_job_events"("jobId", "id");
CREATE INDEX "system_job_events_createdAt_idx"
    ON "system_job_events"("createdAt");

CREATE INDEX "job_resource_leases_ownerJobId_idx"
    ON "job_resource_leases"("ownerJobId");

CREATE UNIQUE INDEX "derived_media_gc_entries_mediaKind_relativePath_key"
    ON "derived_media_gc_entries"("mediaKind", "relativePath");
CREATE INDEX "derived_media_gc_entries_status_notBefore_createdAt_idx"
    ON "derived_media_gc_entries"("status", "notBefore", "createdAt");
CREATE INDEX "derived_media_gc_entries_lastSystemJobId_idx"
    ON "derived_media_gc_entries"("lastSystemJobId");

ALTER TABLE "system_jobs"
    ADD CONSTRAINT "system_jobs_scheduledTaskId_fkey"
    FOREIGN KEY ("scheduledTaskId") REFERENCES "scheduled_tasks"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "system_job_events"
    ADD CONSTRAINT "system_job_events_jobId_fkey"
    FOREIGN KEY ("jobId") REFERENCES "system_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "job_resource_leases"
    ADD CONSTRAINT "job_resource_leases_ownerJobId_fkey"
    FOREIGN KEY ("ownerJobId") REFERENCES "system_jobs"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "derived_media_gc_entries"
    ADD CONSTRAINT "derived_media_gc_entries_lastSystemJobId_fkey"
    FOREIGN KEY ("lastSystemJobId") REFERENCES "system_jobs"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Compatibility phase intentionally stops here. Existing keyframe producers can
-- still write availableAt = NULL. NOT NULL plus lease/skip/scheduled-pair CHECKs
-- are added only after every legacy producer and consumer has been removed.

COMMIT;
