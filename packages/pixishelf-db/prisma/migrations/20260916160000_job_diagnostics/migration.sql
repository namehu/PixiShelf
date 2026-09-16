-- Additive: legacy executions deliberately have no diagnostic identity.
ALTER TABLE "system_jobs" ADD COLUMN "currentDiagnosticExecutionId" UUID;
CREATE TABLE "system_job_diagnostic_reports" (
"id" UUID NOT NULL PRIMARY KEY,
"jobId" TEXT NOT NULL REFERENCES "system_jobs"("id") ON DELETE CASCADE,
"attempt" INTEGER NOT NULL,
"version" INTEGER NOT NULL DEFAULT 1,
"status" VARCHAR(16) NOT NULL DEFAULT 'OPEN',
"outcome" VARCHAR(32),
"entryCount" INTEGER NOT NULL DEFAULT 0,
"itemCount" INTEGER NOT NULL DEFAULT 0,
"currentCount" INTEGER NOT NULL DEFAULT 0,
"inheritedCount" INTEGER NOT NULL DEFAULT 0,
"taskFailure" BOOLEAN NOT NULL DEFAULT false,
"complete" BOOLEAN NOT NULL DEFAULT false,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
"closedAt" TIMESTAMP(3),
"expiresAt" TIMESTAMP(3) NOT NULL,
"expiredAt" TIMESTAMP(3)
);
CREATE TABLE "system_job_diagnostic_items" (
"id" BIGSERIAL NOT NULL PRIMARY KEY,
"reportId" UUID NOT NULL REFERENCES "system_job_diagnostic_reports"("id") ON DELETE CASCADE,
"key" VARCHAR(240) NOT NULL,
"scope" VARCHAR(16) NOT NULL,
"origin" VARCHAR(16) NOT NULL,
"targetType" VARCHAR(80),
"targetId" VARCHAR(240),
"targetLabel" VARCHAR(500),
"stage" VARCHAR(80),
"code" VARCHAR(80) NOT NULL,
"reasonKey" VARCHAR(160) NOT NULL,
"message" VARCHAR(1000) NOT NULL,
"suggestion" VARCHAR(500) NOT NULL,
"evidence" JSONB NOT NULL,
"remoteHost" VARCHAR(253),
"httpStatus" INTEGER,
"itemAttempt" INTEGER,
"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "system_job_diagnostic_reports_jobId_createdAt_id_idx" ON "system_job_diagnostic_reports" ("jobId","createdAt","id");
CREATE INDEX "system_job_diagnostic_reports_status_expiresAt_expiredAt_idx" ON "system_job_diagnostic_reports" ("status","expiresAt","expiredAt");
CREATE UNIQUE INDEX "system_job_diagnostic_items_reportId_key_key" ON "system_job_diagnostic_items" ("reportId","key");
CREATE INDEX "system_job_diagnostic_items_reportId_id_idx" ON "system_job_diagnostic_items" ("reportId","id");
CREATE INDEX "system_job_diagnostic_items_reportId_reasonKey_id_idx" ON "system_job_diagnostic_items" ("reportId","reasonKey","id");
