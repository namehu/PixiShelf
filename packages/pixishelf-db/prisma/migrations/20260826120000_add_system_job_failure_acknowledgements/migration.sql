CREATE TYPE "JobFailureAcknowledgementSource" AS ENUM ('MANUAL', 'RETRY', 'MIGRATION');

CREATE TABLE "system_job_failure_acknowledgements" (
  "jobId" TEXT NOT NULL,
  "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "acknowledgedByUserId" TEXT,
  "source" "JobFailureAcknowledgementSource" NOT NULL,

  CONSTRAINT "system_job_failure_acknowledgements_pkey" PRIMARY KEY ("jobId")
);

CREATE INDEX "system_job_failure_acknowledgements_acknowledgedAt_idx"
  ON "system_job_failure_acknowledgements"("acknowledgedAt");

ALTER TABLE "system_job_failure_acknowledgements"
  ADD CONSTRAINT "system_job_failure_acknowledgements_jobId_fkey"
  FOREIGN KEY ("jobId") REFERENCES "system_jobs"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Existing failures predate the notification workflow. Preserve their execution
-- history while preventing a production upgrade from surfacing an old alert flood.
INSERT INTO "system_job_failure_acknowledgements" (
  "jobId",
  "acknowledgedAt",
  "acknowledgedByUserId",
  "source"
)
SELECT
  "id",
  CURRENT_TIMESTAMP,
  NULL,
  'MIGRATION'::"JobFailureAcknowledgementSource"
FROM "system_jobs"
WHERE "definitionVersion" >= 1
  AND "status" = 'FAILED';
