BEGIN;

-- Fail before any DDL when legacy rows cannot satisfy the new idempotency
-- boundaries. Deployment must resolve these conflicts explicitly; choosing an
-- arbitrary row here would make resume semantics non-deterministic.
DO $$
DECLARE
  duplicate_scan_job TEXT;
  duplicate_pending_directory TEXT;
BEGIN
  SELECT "systemJobId"
    INTO duplicate_scan_job
    FROM "scan_runs"
   WHERE "systemJobId" IS NOT NULL
   GROUP BY "systemJobId"
  HAVING COUNT(*) > 1
   LIMIT 1;

  IF duplicate_scan_job IS NOT NULL THEN
    RAISE EXCEPTION
      'high-risk checkpoint migration requires one scan run per system job; duplicate systemJobId=%',
      duplicate_scan_job;
  END IF;

  SELECT "batchId" || ':' || "sourceDirectoryName"
    INTO duplicate_pending_directory
    FROM "pending_replace_items"
   GROUP BY "batchId", "sourceDirectoryName"
  HAVING COUNT(*) > 1
   LIMIT 1;

  IF duplicate_pending_directory IS NOT NULL THEN
    RAISE EXCEPTION
      'high-risk checkpoint migration requires unique pending source directories per batch; duplicate=%',
      duplicate_pending_directory;
  END IF;
END
$$;

CREATE TYPE "ScanRunLocalWorkInputKind" AS ENUM ('MEDIA_DIRECTORY', 'ARCHIVE_MANIFEST');
CREATE TYPE "PendingReplaceOperationMode" AS ENUM ('DISCOVER', 'BATCH', 'RESTORE', 'CLEANUP');
CREATE TYPE "MigrationItemStatus" AS ENUM (
  'PENDING',
  'RUNNING',
  'PAUSED',
  'RETRY_WAIT',
  'COMPLETED',
  'SKIPPED',
  'FAILED',
  'ACTION_REQUIRED',
  'CANCELLED'
);
CREATE TYPE "MigrationItemPhase" AS ENUM (
  'DISCOVERING',
  'STAGING_FILES',
  'VERIFYING_FILES',
  'PUBLISHING_DATABASE',
  'CLEANING_SOURCE',
  'FINALIZING'
);
CREATE TYPE "MigrationFileStatus" AS ENUM (
  'PENDING',
  'STAGING',
  'STAGED',
  'PUBLISHED',
  'SOURCE_CLEANUP_PENDING',
  'COMPLETED',
  'ACTION_REQUIRED',
  'FAILED'
);

ALTER TABLE "scan_runs"
  ALTER COLUMN "startedAt" DROP DEFAULT,
  ALTER COLUMN "startedAt" DROP NOT NULL,
  ADD COLUMN "inputDigest" VARCHAR(64),
  ADD COLUMN "inputCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "inputFrozenAt" TIMESTAMP(3),
  ADD COLUMN "checkpointStage" VARCHAR(80),
  ADD COLUMN "checkpointOrdinal" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "scan_run_items"
  ADD COLUMN "checkpointKey" VARCHAR(180),
  ADD COLUMN "attempt" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "artwork_external_refs"
  ADD COLUMN "lastSeenScanRunId" VARCHAR(30);

CREATE TABLE "scan_run_metadata_inputs" (
  "id" TEXT NOT NULL,
  "scanRunId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "relativePath" TEXT NOT NULL,
  "contentHash" VARCHAR(64),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scan_run_metadata_inputs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scan_run_local_work_inputs" (
  "id" TEXT NOT NULL,
  "scanRunId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "kind" "ScanRunLocalWorkInputKind" NOT NULL,
  "relativePath" TEXT NOT NULL,
  "fingerprint" VARCHAR(128),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scan_run_local_work_inputs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "scan_run_local_artist_mapping_inputs" (
  "id" TEXT NOT NULL,
  "scanRunId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "artistDirectory" TEXT NOT NULL,
  "artistId" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "scan_run_local_artist_mapping_inputs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pending_replace_operations" (
  "systemJobId" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "itemId" TEXT,
  "mode" "PendingReplaceOperationMode" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "pending_replace_operations_pkey" PRIMARY KEY ("systemJobId")
);

CREATE TABLE "migration_job_items" (
  "id" TEXT NOT NULL,
  "systemJobId" TEXT NOT NULL,
  "artworkIdSnapshot" INTEGER NOT NULL,
  "selectionOrdinal" INTEGER,
  "status" "MigrationItemStatus" NOT NULL DEFAULT 'PENDING',
  "phase" "MigrationItemPhase" NOT NULL DEFAULT 'DISCOVERING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "sourceDirectory" TEXT,
  "targetDirectory" TEXT,
  "sourceFingerprint" VARCHAR(128),
  "targetFingerprint" VARCHAR(128),
  "errorCode" VARCHAR(80),
  "errorSummary" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "migration_job_items_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "migration_file_entries" (
  "id" TEXT NOT NULL,
  "itemId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "imageId" INTEGER,
  "sourceRelativePath" TEXT NOT NULL,
  "targetRelativePath" TEXT NOT NULL,
  "stagedRelativePath" TEXT,
  "status" "MigrationFileStatus" NOT NULL DEFAULT 'PENDING',
  "attempt" INTEGER NOT NULL DEFAULT 0,
  "sourceSize" BIGINT,
  "sourceMtimeMs" BIGINT,
  "sourceSha256" VARCHAR(64),
  "stagedSha256" VARCHAR(64),
  "transferredAt" TIMESTAMP(3),
  "publishedAt" TIMESTAMP(3),
  "cleanedAt" TIMESTAMP(3),
  "errorCode" VARCHAR(80),
  "errorSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "migration_file_entries_pkey" PRIMARY KEY ("id")
);

DROP INDEX "scan_runs_systemJobId_idx";
CREATE UNIQUE INDEX "scan_runs_systemJobId_key" ON "scan_runs"("systemJobId");
CREATE UNIQUE INDEX "scan_run_items_run_checkpoint_key" ON "scan_run_items"("scanRunId", "checkpointKey");
CREATE UNIQUE INDEX "scan_metadata_inputs_run_ordinal_key" ON "scan_run_metadata_inputs"("scanRunId", "ordinal");
CREATE UNIQUE INDEX "scan_metadata_inputs_run_path_key" ON "scan_run_metadata_inputs"("scanRunId", "relativePath");
CREATE UNIQUE INDEX "scan_local_work_inputs_run_ordinal_key" ON "scan_run_local_work_inputs"("scanRunId", "ordinal");
CREATE UNIQUE INDEX "scan_local_work_inputs_run_kind_path_key" ON "scan_run_local_work_inputs"("scanRunId", "kind", "relativePath");
CREATE UNIQUE INDEX "scan_local_artist_inputs_run_ordinal_key" ON "scan_run_local_artist_mapping_inputs"("scanRunId", "ordinal");
CREATE UNIQUE INDEX "scan_local_artist_inputs_run_directory_key" ON "scan_run_local_artist_mapping_inputs"("scanRunId", "artistDirectory");
CREATE INDEX "artwork_external_refs_lastSeenScanRunId_idx" ON "artwork_external_refs"("lastSeenScanRunId");
CREATE INDEX "artwork_external_refs_reconcile_sweep_idx" ON "artwork_external_refs"("providerKey", "createdAt", "lastSeenScanRunId");
CREATE UNIQUE INDEX "pending_replace_items_batch_source_directory_key" ON "pending_replace_items"("batchId", "sourceDirectoryName");
CREATE UNIQUE INDEX "pending_replace_items_id_batch_key" ON "pending_replace_items"("id", "batchId");
CREATE INDEX "pending_replace_operations_batchId_idx" ON "pending_replace_operations"("batchId");
CREATE INDEX "pending_replace_operations_itemId_idx" ON "pending_replace_operations"("itemId");
CREATE UNIQUE INDEX "migration_job_items_systemJobId_artworkIdSnapshot_key" ON "migration_job_items"("systemJobId", "artworkIdSnapshot");
CREATE INDEX "migration_job_items_systemJobId_status_artworkIdSnapshot_idx" ON "migration_job_items"("systemJobId", "status", "artworkIdSnapshot");
CREATE INDEX "migration_job_items_status_updatedAt_idx" ON "migration_job_items"("status", "updatedAt");
CREATE UNIQUE INDEX "migration_file_entries_itemId_ordinal_key" ON "migration_file_entries"("itemId", "ordinal");
CREATE UNIQUE INDEX "migration_file_entries_itemId_sourceRelativePath_key" ON "migration_file_entries"("itemId", "sourceRelativePath");
CREATE UNIQUE INDEX "migration_file_entries_item_target_path_key" ON "migration_file_entries"("itemId", "targetRelativePath");
CREATE INDEX "migration_file_entries_itemId_status_ordinal_idx" ON "migration_file_entries"("itemId", "status", "ordinal");

ALTER TABLE "scan_runs"
  ADD CONSTRAINT "scan_runs_input_count_check" CHECK ("inputCount" >= 0),
  ADD CONSTRAINT "scan_runs_checkpoint_ordinal_check" CHECK ("checkpointOrdinal" >= 0),
  ADD CONSTRAINT "scan_runs_input_digest_check" CHECK ("inputDigest" IS NULL OR "inputDigest" ~ '^[a-f0-9]{64}$');

ALTER TABLE "scan_run_items"
  ADD CONSTRAINT "scan_run_items_attempt_check" CHECK ("attempt" >= 0);

ALTER TABLE "scan_run_metadata_inputs"
  ADD CONSTRAINT "scan_metadata_inputs_ordinal_check" CHECK ("ordinal" >= 0),
  ADD CONSTRAINT "scan_metadata_inputs_hash_check" CHECK ("contentHash" IS NULL OR "contentHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "scan_run_local_work_inputs"
  ADD CONSTRAINT "scan_local_work_inputs_ordinal_check" CHECK ("ordinal" >= 0);

ALTER TABLE "scan_run_local_artist_mapping_inputs"
  ADD CONSTRAINT "scan_local_artist_inputs_ordinal_check" CHECK ("ordinal" >= 0),
  ADD CONSTRAINT "scan_local_artist_inputs_artist_id_check" CHECK ("artistId" > 0);

ALTER TABLE "pending_replace_operations"
  ADD CONSTRAINT "pending_replace_operations_item_mode_check" CHECK (
    ("mode" = 'RESTORE' AND "itemId" IS NOT NULL)
    OR ("mode" <> 'RESTORE' AND "itemId" IS NULL)
  );

ALTER TABLE "migration_job_items"
  ADD CONSTRAINT "migration_job_items_artwork_id_check" CHECK ("artworkIdSnapshot" > 0),
  ADD CONSTRAINT "migration_job_items_selection_ordinal_check" CHECK ("selectionOrdinal" IS NULL OR "selectionOrdinal" >= 0),
  ADD CONSTRAINT "migration_job_items_attempt_check" CHECK ("attempt" >= 0);

ALTER TABLE "migration_file_entries"
  ADD CONSTRAINT "migration_file_entries_ordinal_check" CHECK ("ordinal" >= 0),
  ADD CONSTRAINT "migration_file_entries_attempt_check" CHECK ("attempt" >= 0),
  ADD CONSTRAINT "migration_file_entries_source_size_check" CHECK ("sourceSize" IS NULL OR "sourceSize" >= 0),
  ADD CONSTRAINT "migration_file_entries_source_mtime_check" CHECK ("sourceMtimeMs" IS NULL OR "sourceMtimeMs" >= 0),
  ADD CONSTRAINT "migration_file_entries_source_hash_check" CHECK ("sourceSha256" IS NULL OR "sourceSha256" ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT "migration_file_entries_staged_hash_check" CHECK ("stagedSha256" IS NULL OR "stagedSha256" ~ '^[a-f0-9]{64}$');

ALTER TABLE "scan_run_metadata_inputs"
  ADD CONSTRAINT "scan_run_metadata_inputs_scanRunId_fkey"
  FOREIGN KEY ("scanRunId") REFERENCES "scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scan_run_local_work_inputs"
  ADD CONSTRAINT "scan_run_local_work_inputs_scanRunId_fkey"
  FOREIGN KEY ("scanRunId") REFERENCES "scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "scan_run_local_artist_mapping_inputs"
  ADD CONSTRAINT "scan_run_local_artist_mapping_inputs_scanRunId_fkey"
  FOREIGN KEY ("scanRunId") REFERENCES "scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "pending_replace_operations"
  ADD CONSTRAINT "pending_replace_operations_systemJobId_fkey"
  FOREIGN KEY ("systemJobId") REFERENCES "system_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD CONSTRAINT "pending_replace_operations_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "pending_replace_batches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "pending_replace_operations_itemId_batchId_fkey"
  FOREIGN KEY ("itemId", "batchId") REFERENCES "pending_replace_items"("id", "batchId") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "migration_job_items"
  ADD CONSTRAINT "migration_job_items_systemJobId_fkey"
  FOREIGN KEY ("systemJobId") REFERENCES "system_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "migration_file_entries"
  ADD CONSTRAINT "migration_file_entries_itemId_fkey"
  FOREIGN KEY ("itemId") REFERENCES "migration_job_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
