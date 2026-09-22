BEGIN;

ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_type_execution_lane_check";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_type_execution_lane_check" CHECK (
  ("type" IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN', 'ARCHIVE_SEARCH_SCAN', 'ARCHIVE_DISCOVERY_BATCH_SCAN') AND "executionLane" = 'ARCHIVE_RESOLVE')
  OR ("type" NOT IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN', 'ARCHIVE_SEARCH_SCAN', 'ARCHIVE_DISCOVERY_BATCH_SCAN') AND "executionLane" = 'BACKGROUND_WRITER')
);

CREATE UNIQUE INDEX "system_jobs_one_active_discovery_batch"
  ON "system_jobs" ("type")
  WHERE "type" = 'ARCHIVE_DISCOVERY_BATCH_SCAN'
    AND "status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSING', 'PAUSED', 'CANCELLING');

COMMIT;
