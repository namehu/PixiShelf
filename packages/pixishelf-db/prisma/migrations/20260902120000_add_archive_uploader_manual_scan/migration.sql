ALTER TYPE "ArchiveProviderRequestClass" ADD VALUE IF NOT EXISTS 'SEARCH';

CREATE TYPE "ArchiveUploaderIdentityKind" AS ENUM ('NAME', 'UID');
CREATE TYPE "ArchiveUploaderSourceStatus" AS ENUM ('ACTIVE', 'ARCHIVED');
CREATE TYPE "ArchiveUploaderScanMode" AS ENUM ('LATEST', 'HISTORY');
CREATE TYPE "ArchiveUploaderScanRunStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'RETRY_WAIT',
  'PAUSED',
  'COMPLETED',
  'FAILED',
  'CANCELLED'
);
CREATE TYPE "ArchiveUploaderScanClassification" AS ENUM (
  'NEW',
  'ACTIVE',
  'ARCHIVED',
  'POSSIBLE_UPDATE',
  'REPLACEMENT'
);

CREATE TABLE "archive_uploader_sources" (
  "id" TEXT NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "identityKind" "ArchiveUploaderIdentityKind" NOT NULL,
  "identityValue" VARCHAR(180) NOT NULL,
  "normalizedIdentity" VARCHAR(180) NOT NULL,
  "displayName" VARCHAR(180) NOT NULL,
  "status" "ArchiveUploaderSourceStatus" NOT NULL DEFAULT 'ACTIVE',
  "latestSeenExternalId" VARCHAR(120),
  "incrementalCursor" TEXT,
  "incrementalHeadExternalId" VARCHAR(120),
  "historyCursor" TEXT,
  "lastScanAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "lastErrorMessage" TEXT,
  "lastRunId" VARCHAR(128),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "archive_uploader_sources_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "archive_uploader_scan_runs" (
  "id" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "systemJobId" TEXT NOT NULL,
  "mode" "ArchiveUploaderScanMode" NOT NULL,
  "status" "ArchiveUploaderScanRunStatus" NOT NULL DEFAULT 'PENDING',
  "cursorBefore" TEXT,
  "cursorAfter" TEXT,
  "itemCount" INTEGER NOT NULL DEFAULT 0,
  "newCount" INTEGER NOT NULL DEFAULT 0,
  "activeCount" INTEGER NOT NULL DEFAULT 0,
  "archivedCount" INTEGER NOT NULL DEFAULT 0,
  "possibleUpdateCount" INTEGER NOT NULL DEFAULT 0,
  "replacementCount" INTEGER NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "errorCode" VARCHAR(80),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "archive_uploader_scan_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "archive_uploader_scan_items" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" VARCHAR(120) NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "thumbnailUrl" TEXT,
  "uploaderName" VARCHAR(180),
  "postedAt" TIMESTAMP(3),
  "metadataFingerprint" VARCHAR(64) NOT NULL,
  "relationships" JSONB NOT NULL,
  "classification" "ArchiveUploaderScanClassification" NOT NULL,
  "intakeItemId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "archive_uploader_scan_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archive_uploader_sources_provider_identity_key"
  ON "archive_uploader_sources"("providerKey", "identityKind", "normalizedIdentity");
CREATE INDEX "archive_uploader_sources_status_updated_idx"
  ON "archive_uploader_sources"("status", "updatedAt" DESC);
CREATE INDEX "archive_uploader_sources_last_run_idx"
  ON "archive_uploader_sources"("lastRunId");

CREATE UNIQUE INDEX "archive_uploader_scan_runs_system_job_key"
  ON "archive_uploader_scan_runs"("systemJobId");
CREATE INDEX "archive_uploader_scan_runs_source_created_idx"
  ON "archive_uploader_scan_runs"("sourceId", "createdAt" DESC);
CREATE INDEX "archive_uploader_scan_runs_status_created_idx"
  ON "archive_uploader_scan_runs"("status", "createdAt");
CREATE UNIQUE INDEX "archive_uploader_scan_runs_one_active_per_source_idx"
  ON "archive_uploader_scan_runs"("sourceId")
  WHERE "status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED');

CREATE UNIQUE INDEX "archive_uploader_scan_items_intake_item_key"
  ON "archive_uploader_scan_items"("intakeItemId");
CREATE UNIQUE INDEX "archive_uploader_scan_items_run_provider_external_key"
  ON "archive_uploader_scan_items"("runId", "providerKey", "externalId");
CREATE INDEX "archive_uploader_scan_items_run_classification_posted_idx"
  ON "archive_uploader_scan_items"("runId", "classification", "postedAt" DESC);
CREATE INDEX "archive_uploader_scan_items_provider_external_idx"
  ON "archive_uploader_scan_items"("providerKey", "externalId");

ALTER TABLE "archive_uploader_scan_runs"
  ADD CONSTRAINT "archive_uploader_scan_runs_source_fkey"
  FOREIGN KEY ("sourceId") REFERENCES "archive_uploader_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "archive_uploader_scan_runs"
  ADD CONSTRAINT "archive_uploader_scan_runs_system_job_fkey"
  FOREIGN KEY ("systemJobId") REFERENCES "system_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "archive_uploader_scan_items"
  ADD CONSTRAINT "archive_uploader_scan_items_run_fkey"
  FOREIGN KEY ("runId") REFERENCES "archive_uploader_scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "archive_uploader_scan_items"
  ADD CONSTRAINT "archive_uploader_scan_items_intake_item_fkey"
  FOREIGN KEY ("intakeItemId") REFERENCES "archive_intake_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "system_jobs" DROP CONSTRAINT IF EXISTS "system_jobs_type_execution_lane_check";
ALTER TABLE "system_jobs"
  ADD CONSTRAINT "system_jobs_type_execution_lane_check" CHECK (
    (
      "type" IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN')
      AND "executionLane" = 'ARCHIVE_RESOLVE'
    )
    OR
    (
      "type" NOT IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN')
      AND "executionLane" = 'BACKGROUND_WRITER'
    )
  );
