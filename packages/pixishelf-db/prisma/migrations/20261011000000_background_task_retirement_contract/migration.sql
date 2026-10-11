-- Stop all writers and take a matching recovery checkpoint before deployment.
BEGIN;
-- Locks make the preflight and destructive DDL one atomic boundary.
LOCK TABLE system_jobs, scheduled_tasks, job_resource_leases IN ACCESS EXCLUSIVE MODE;
DO $retirement$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name = '20261007100000_background_task_retirement_read_model' AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
    RAISE EXCEPTION 'Background task retirement blocked: phase one migration is not complete';
  END IF;
  IF EXISTS (SELECT 1 FROM system_jobs WHERE status IN ('RUNNING','PAUSING','CANCELLING')) THEN
    RAISE EXCEPTION 'Background task retirement blocked: executing_jobs; run --phase2-before for task IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM job_resource_leases WHERE "expiresAt" > CURRENT_TIMESTAMP) THEN
    RAISE EXCEPTION 'Background task retirement blocked: live_resource_leases; run --phase2-before for task IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM system_jobs WHERE "definitionVersion" = 0 AND "legacyDisplay" IS DISTINCT FROM jsonb_build_object('schemaVersion',1,'targetImageId',"targetImageId",'targetPath',"targetPath",'mode',mode)) THEN
    RAISE EXCEPTION 'Background task retirement blocked: legacy_snapshot_mismatch; run --phase2-before for task IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM system_jobs WHERE "definitionVersion" = 0 AND NOT COALESCE(jsonb_typeof("legacyDisplay") = 'object' AND "legacyDisplay"->'schemaVersion' = '1'::jsonb AND "legacyDisplay" ?& ARRAY['targetImageId','targetPath','mode'] AND jsonb_typeof("legacyDisplay"->'targetImageId') IN ('number','null') AND jsonb_typeof("legacyDisplay"->'targetPath') IN ('string','null') AND jsonb_typeof("legacyDisplay"->'mode') IN ('string','null'), false)) THEN
    RAISE EXCEPTION 'Background task retirement blocked: invalid_legacy_snapshot; run --phase2-before for task IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM system_jobs WHERE "definitionVersion" = 1 AND type IN ('VIDEO_KEYFRAME_GENERATION','VIDEO_STREAMING_OPTIMIZATION') AND (to_jsonb("targetImageId") IS DISTINCT FROM payload->'imageId' OR "targetPath" IS DISTINCT FROM payload->>'relativePath' OR mode IS DISTINCT FROM payload->>'mode')) THEN
    RAISE EXCEPTION 'Background task retirement blocked: rollback_projection_mismatch; run --phase2-before for task IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM system_jobs WHERE NOT ("definitionVersion" <> 0 OR status IN ('COMPLETED','FAILED','CANCELLED','SKIPPED'))) THEN
    RAISE EXCEPTION 'Background task retirement blocked: system_jobs_legacy_terminal_check; run --phase2-before for task IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM system_jobs WHERE NOT ("definitionVersion" = 0 OR (CASE WHEN status IN ('RUNNING','PAUSING','CANCELLING') THEN "workerId" IS NOT NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL ELSE "workerId" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL END))) THEN
    RAISE EXCEPTION 'Background task retirement blocked: system_jobs_central_lease_check; run --phase2-before for task IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM system_jobs WHERE NOT ("definitionVersion" = 0 OR (CASE WHEN status = 'SKIPPED' THEN "skipReason" IS NOT NULL AND "skippedAt" IS NOT NULL ELSE "skipReason" IS NULL AND "skippedAt" IS NULL END))) THEN
    RAISE EXCEPTION 'Background task retirement blocked: system_jobs_central_skip_check; run --phase2-before for task IDs';
  END IF;
  IF EXISTS (SELECT 1 FROM system_jobs WHERE NOT ("definitionVersion" = 0 OR (CASE WHEN "triggerSource" = 'SCHEDULE' THEN "scheduledForDate" IS NOT NULL ELSE "scheduledTaskId" IS NULL AND "scheduledForDate" IS NULL END))) THEN
    RAISE EXCEPTION 'Background task retirement blocked: system_jobs_central_schedule_check; run --phase2-before for task IDs';
  END IF;
END
$retirement$;

UPDATE system_jobs SET "availableAt" = "createdAt" WHERE "availableAt" IS NULL;
ALTER TABLE system_jobs ALTER COLUMN "availableAt" SET NOT NULL;
ALTER TABLE system_jobs ADD CONSTRAINT "system_jobs_legacy_terminal_check" CHECK ("definitionVersion" <> 0 OR status IN ('COMPLETED','FAILED','CANCELLED','SKIPPED')) NOT VALID;
ALTER TABLE system_jobs VALIDATE CONSTRAINT "system_jobs_legacy_terminal_check";
ALTER TABLE system_jobs ADD CONSTRAINT "system_jobs_central_lease_check" CHECK ("definitionVersion" = 0 OR (CASE WHEN status IN ('RUNNING','PAUSING','CANCELLING') THEN "workerId" IS NOT NULL AND "leaseToken" IS NOT NULL AND "leaseExpiresAt" IS NOT NULL ELSE "workerId" IS NULL AND "leaseToken" IS NULL AND "leaseExpiresAt" IS NULL END)) NOT VALID;
ALTER TABLE system_jobs VALIDATE CONSTRAINT "system_jobs_central_lease_check";
ALTER TABLE system_jobs ADD CONSTRAINT "system_jobs_central_skip_check" CHECK ("definitionVersion" = 0 OR (CASE WHEN status = 'SKIPPED' THEN "skipReason" IS NOT NULL AND "skippedAt" IS NOT NULL ELSE "skipReason" IS NULL AND "skippedAt" IS NULL END)) NOT VALID;
ALTER TABLE system_jobs VALIDATE CONSTRAINT "system_jobs_central_skip_check";
ALTER TABLE system_jobs ADD CONSTRAINT "system_jobs_central_schedule_check" CHECK ("definitionVersion" = 0 OR (CASE WHEN "triggerSource" = 'SCHEDULE' THEN "scheduledForDate" IS NOT NULL ELSE "scheduledTaskId" IS NULL AND "scheduledForDate" IS NULL END)) NOT VALID;
ALTER TABLE system_jobs VALIDATE CONSTRAINT "system_jobs_central_schedule_check";

DROP INDEX IF EXISTS "system_jobs_type_targetImageId_createdAt_idx";
DROP INDEX IF EXISTS "scheduled_tasks_mutexKey_idx";
ALTER TABLE system_jobs DROP COLUMN "targetImageId", DROP COLUMN "targetPath", DROP COLUMN mode;
ALTER TABLE scheduled_tasks DROP COLUMN time, DROP COLUMN timezone, DROP COLUMN "mutexKey", DROP COLUMN "lastTriggeredAt", DROP COLUMN "lastTriggeredDate";
COMMIT;
