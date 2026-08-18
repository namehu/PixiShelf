BEGIN;

-- The original dual-lane constraint already maps every non-resolver job to the
-- writer lane. Keep that expand-safe rule and add a named maintenance-specific
-- guard so older application binaries and manual inserts cannot misroute it.
ALTER TABLE "system_jobs"
  ADD CONSTRAINT "system_jobs_archive_maintenance_lane_check" CHECK (
    "type" <> 'ARCHIVE_MAINTENANCE'
    OR "executionLane" = 'BACKGROUND_WRITER'
  ) NOT VALID;

ALTER TABLE "system_jobs"
  VALIDATE CONSTRAINT "system_jobs_archive_maintenance_lane_check";

COMMIT;
