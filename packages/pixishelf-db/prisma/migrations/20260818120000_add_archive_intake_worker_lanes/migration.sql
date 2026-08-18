BEGIN;

-- This is a coordinated execution-fence cutover. Refuse to change the queue
-- topology while an old dispatcher may still own work or a live global lease.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "system_jobs"
    WHERE "status" IN ('RUNNING', 'PAUSING', 'CANCELLING')
  ) THEN
    RAISE EXCEPTION 'archive lane cutover requires zero executing system jobs'
      USING ERRCODE = '55000';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM "job_resource_leases"
    WHERE "resourceKey" = 'global/background-worker'
      AND "expiresAt" > CURRENT_TIMESTAMP
  ) THEN
    RAISE EXCEPTION 'archive lane cutover requires the legacy global worker lease to expire'
      USING ERRCODE = '55000';
  END IF;
END $$;

DELETE FROM "job_resource_leases"
WHERE "resourceKey" = 'global/background-worker';

CREATE TYPE "JobExecutionLane" AS ENUM ('ARCHIVE_RESOLVE', 'BACKGROUND_WRITER');
CREATE TYPE "ArchiveIntakeStatus" AS ENUM (
  'QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE',
  'FAILED', 'ENQUEUED', 'CANCELLED', 'DUPLICATE'
);
CREATE TYPE "ArchiveIntakeResolutionKind" AS ENUM (
  'NEW', 'UPDATE', 'UNCHANGED', 'ACTIVE_TASK', 'DUPLICATE_IDENTITY'
);
CREATE TYPE "ArchiveBulkOperationCommand" AS ENUM ('ENQUEUE', 'PAUSE', 'RESUME', 'CANCEL', 'RETRY');
CREATE TYPE "ArchiveBulkOperationTarget" AS ENUM ('INTAKE_ITEM', 'ARCHIVE_IMPORT');
CREATE TYPE "ArchiveBulkOperationResult" AS ENUM ('CREATED', 'APPLIED', 'REUSED', 'SKIPPED', 'CONFLICT', 'FAILED');
CREATE TYPE "ArchiveProviderRequestClass" AS ENUM ('RESOLVE', 'DOWNLOAD');

ALTER TABLE "system_jobs"
  ADD COLUMN "executionLane" "JobExecutionLane" NOT NULL DEFAULT 'BACKGROUND_WRITER';

-- Keep the database as the final authority for the fixed job-type/lane map.
-- Existing and future non-resolver job types stay in the serialized writer
-- lane; the resolver type can never be inserted with the writer default.
ALTER TABLE "system_jobs"
  ADD CONSTRAINT "system_jobs_type_execution_lane_check" CHECK (
    (
      "type" = 'ARCHIVE_RESOLVE_ITEM'
      AND "executionLane" = 'ARCHIVE_RESOLVE'
    )
    OR (
      "type" <> 'ARCHIVE_RESOLVE_ITEM'
      AND "executionLane" = 'BACKGROUND_WRITER'
    )
  );

DROP INDEX "system_jobs_single_executing_job_idx";
CREATE UNIQUE INDEX "system_jobs_single_executing_per_lane_idx"
  ON "system_jobs" ("executionLane")
  WHERE "status" IN ('RUNNING', 'PAUSING', 'CANCELLING');
CREATE INDEX "system_jobs_lane_claim_idx"
  ON "system_jobs" ("executionLane", "status", "effectivePriority", "availableAt", "createdAt");

CREATE TABLE "archive_intake_submissions" (
  "id" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(180) NOT NULL,
  "requestedByUserId" TEXT,
  "rawCount" INTEGER NOT NULL,
  "acceptedCount" INTEGER NOT NULL,
  "invalidCount" INTEGER NOT NULL DEFAULT 0,
  "duplicateCount" INTEGER NOT NULL DEFAULT 0,
  "rejectedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archive_intake_submissions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "archive_intake_submissions_counts_check" CHECK (
    "rawCount" >= 0 AND "acceptedCount" >= 0 AND "invalidCount" >= 0
    AND "duplicateCount" >= 0 AND "rejectedCount" >= 0
  )
);

CREATE TABLE "archive_intake_items" (
  "id" TEXT NOT NULL,
  "submissionId" TEXT NOT NULL,
  "submittedUrl" TEXT NOT NULL,
  "normalizedUrlHash" VARCHAR(64) NOT NULL,
  "queueOrder" BIGSERIAL NOT NULL,
  "status" "ArchiveIntakeStatus" NOT NULL DEFAULT 'QUEUED',
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cancelRequestedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "providerKey" VARCHAR(50),
  "externalId" TEXT,
  "canonicalUrl" TEXT,
  "resolvedTitle" TEXT,
  "thumbnailUrl" TEXT,
  "pageCount" INTEGER,
  "resolvedSnapshot" JSONB,
  "metadataHash" VARCHAR(64),
  "resolutionKind" "ArchiveIntakeResolutionKind",
  "duplicateOfItemId" TEXT,
  "activeArchiveImportId" TEXT,
  "selectedQuality" "ArchiveQuality" NOT NULL DEFAULT 'ORIGINAL',
  "resolvedAt" TIMESTAMP(3),
  "expiresAt" TIMESTAMP(3),
  "archiveImportId" TEXT,
  "errorCode" VARCHAR(80),
  "errorMessage" TEXT,
  "errorStage" VARCHAR(40),
  "retryable" BOOLEAN,
  "supersedesItemId" TEXT,
  "currentSystemJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "archive_intake_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "archive_intake_items_attempts_check" CHECK ("attempts" >= 0),
  CONSTRAINT "archive_intake_items_page_count_check" CHECK ("pageCount" IS NULL OR "pageCount" >= 0)
);

CREATE TABLE "archive_bulk_operations" (
  "id" TEXT NOT NULL,
  "idempotencyKey" VARCHAR(180) NOT NULL,
  "requestedByUserId" TEXT,
  "commandType" "ArchiveBulkOperationCommand" NOT NULL,
  "requestedCount" INTEGER NOT NULL,
  "createdCount" INTEGER NOT NULL DEFAULT 0,
  "appliedCount" INTEGER NOT NULL DEFAULT 0,
  "reusedCount" INTEGER NOT NULL DEFAULT 0,
  "skippedCount" INTEGER NOT NULL DEFAULT 0,
  "conflictCount" INTEGER NOT NULL DEFAULT 0,
  "failedCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "archive_bulk_operations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "archive_bulk_operations_counts_check" CHECK (
    "requestedCount" >= 0 AND "createdCount" >= 0 AND "appliedCount" >= 0 AND "reusedCount" >= 0
    AND "skippedCount" >= 0 AND "conflictCount" >= 0 AND "failedCount" >= 0
  )
);

CREATE TABLE "archive_bulk_operation_items" (
  "id" TEXT NOT NULL,
  "operationId" TEXT NOT NULL,
  "targetType" "ArchiveBulkOperationTarget" NOT NULL,
  "targetId" VARCHAR(128) NOT NULL,
  "result" "ArchiveBulkOperationResult" NOT NULL,
  "relatedId" VARCHAR(128),
  "code" VARCHAR(80),
  "message" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archive_bulk_operation_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "archive_resolve_queue_control" (
  "id" VARCHAR(40) NOT NULL DEFAULT 'archive-resolve',
  "paused" BOOLEAN NOT NULL DEFAULT false,
  "pausedAt" TIMESTAMP(3),
  "pausedBy" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archive_resolve_queue_control_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "archive_resolve_queue_control_singleton_check" CHECK ("id" = 'archive-resolve')
);

INSERT INTO "archive_resolve_queue_control" ("id") VALUES ('archive-resolve');

CREATE TABLE "archive_provider_throttles" (
  "providerKey" VARCHAR(50) NOT NULL,
  "nextRequestAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "penaltyUntil" TIMESTAMP(3),
  "penaltyCode" VARCHAR(40),
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "archive_provider_throttles_pkey" PRIMARY KEY ("providerKey"),
  CONSTRAINT "archive_provider_throttles_version_check" CHECK ("version" >= 0)
);

CREATE TABLE "archive_provider_request_leases" (
  "id" UUID NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "requestClass" "ArchiveProviderRequestClass" NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "archive_provider_request_leases_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "archive_intake_submissions_idempotencyKey_key"
  ON "archive_intake_submissions" ("idempotencyKey");
CREATE INDEX "archive_intake_submissions_createdAt_idx"
  ON "archive_intake_submissions" ("createdAt" DESC);
CREATE UNIQUE INDEX "archive_intake_items_queueOrder_key" ON "archive_intake_items" ("queueOrder");
CREATE UNIQUE INDEX "archive_intake_items_currentSystemJobId_key" ON "archive_intake_items" ("currentSystemJobId");
CREATE INDEX "archive_intake_items_status_queueOrder_idx" ON "archive_intake_items" ("status", "queueOrder");
CREATE INDEX "archive_intake_items_submissionId_createdAt_idx" ON "archive_intake_items" ("submissionId", "createdAt");
CREATE INDEX "archive_intake_items_normalizedUrlHash_status_idx" ON "archive_intake_items" ("normalizedUrlHash", "status");
CREATE UNIQUE INDEX "archive_intake_items_active_url_hash_idx"
  ON "archive_intake_items" ("normalizedUrlHash")
  WHERE "status" IN ('QUEUED', 'RESOLVING', 'RETRY_WAIT', 'READY', 'STALE');
CREATE INDEX "archive_intake_items_providerKey_externalId_idx" ON "archive_intake_items" ("providerKey", "externalId");
CREATE INDEX "archive_intake_items_archiveImportId_idx" ON "archive_intake_items" ("archiveImportId");
CREATE INDEX "archive_intake_items_activeArchiveImportId_idx" ON "archive_intake_items" ("activeArchiveImportId");
CREATE INDEX "archive_intake_items_duplicateOfItemId_idx" ON "archive_intake_items" ("duplicateOfItemId");
CREATE INDEX "archive_intake_items_supersedesItemId_idx" ON "archive_intake_items" ("supersedesItemId");
CREATE INDEX "archive_intake_items_finishedAt_idx" ON "archive_intake_items" ("finishedAt");
CREATE UNIQUE INDEX "archive_intake_items_active_identity_idx"
  ON "archive_intake_items" ("providerKey", "externalId")
  WHERE "providerKey" IS NOT NULL AND "externalId" IS NOT NULL
    AND "status" IN ('RESOLVING', 'RETRY_WAIT', 'READY', 'STALE');
CREATE UNIQUE INDEX "archive_bulk_operations_idempotencyKey_key" ON "archive_bulk_operations" ("idempotencyKey");
CREATE INDEX "archive_bulk_operations_createdAt_idx" ON "archive_bulk_operations" ("createdAt" DESC);
CREATE UNIQUE INDEX "archive_bulk_operation_items_operationId_targetType_targetId_key"
  ON "archive_bulk_operation_items" ("operationId", "targetType", "targetId");
CREATE INDEX "archive_bulk_operation_items_targetType_targetId_idx"
  ON "archive_bulk_operation_items" ("targetType", "targetId");
CREATE INDEX "archive_provider_throttles_nextRequestAt_idx" ON "archive_provider_throttles" ("nextRequestAt");
CREATE INDEX "archive_provider_throttles_penaltyUntil_idx" ON "archive_provider_throttles" ("penaltyUntil");
CREATE INDEX "archive_provider_request_leases_providerKey_requestClass_expiresAt_idx"
  ON "archive_provider_request_leases" ("providerKey", "requestClass", "expiresAt");
CREATE INDEX "archive_provider_request_leases_expiresAt_idx" ON "archive_provider_request_leases" ("expiresAt");

ALTER TABLE "archive_intake_items"
  ADD CONSTRAINT "archive_intake_items_submissionId_fkey"
  FOREIGN KEY ("submissionId") REFERENCES "archive_intake_submissions" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "archive_intake_items_duplicateOfItemId_fkey"
  FOREIGN KEY ("duplicateOfItemId") REFERENCES "archive_intake_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "archive_intake_items_supersedesItemId_fkey"
  FOREIGN KEY ("supersedesItemId") REFERENCES "archive_intake_items" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "archive_intake_items_currentSystemJobId_fkey"
  FOREIGN KEY ("currentSystemJobId") REFERENCES "system_jobs" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "archive_intake_items_activeArchiveImportId_fkey"
  FOREIGN KEY ("activeArchiveImportId") REFERENCES "archive_imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "archive_intake_items_archiveImportId_fkey"
  FOREIGN KEY ("archiveImportId") REFERENCES "archive_imports" ("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "archive_bulk_operation_items"
  ADD CONSTRAINT "archive_bulk_operation_items_operationId_fkey"
  FOREIGN KEY ("operationId") REFERENCES "archive_bulk_operations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "archive_provider_request_leases"
  ADD CONSTRAINT "archive_provider_request_leases_providerKey_fkey"
  FOREIGN KEY ("providerKey") REFERENCES "archive_provider_throttles" ("providerKey")
  ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
