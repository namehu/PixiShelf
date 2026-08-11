ALTER TABLE "system_jobs"
ADD COLUMN "startedAt" TIMESTAMP(3),
ADD COLUMN "heartbeatAt" TIMESTAMP(3),
ADD COLUMN "finishedAt" TIMESTAMP(3),
ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "system_jobs_type_status_createdAt_idx"
ON "system_jobs"("type", "status", "createdAt");

CREATE INDEX "system_jobs_type_status_finishedAt_idx"
ON "system_jobs"("type", "status", "finishedAt");
