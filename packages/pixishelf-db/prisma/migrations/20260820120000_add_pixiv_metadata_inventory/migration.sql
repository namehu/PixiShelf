-- Stage 2 is expand-only: existing scan rows and domain records are not rewritten.
CREATE TYPE "PixivMetadataInventoryStatus" AS ENUM ('INITIALIZING', 'READY');

ALTER TABLE "scan_runs"
  -- NULL means the metric predates inventory instrumentation; zero is reserved for a measured empty count.
  ADD COLUMN "walkedEntries" INTEGER,
  ADD COLUMN "metadataCandidates" INTEGER,
  ADD COLUMN "inventoryUnchanged" INTEGER,
  ADD COLUMN "contentHashed" INTEGER,
  ADD COLUMN "contentChanged" INTEGER,
  ADD COLUMN "parsedInputs" INTEGER,
  ADD COLUMN "publishedInputs" INTEGER,
  ADD COLUMN "failedInputs" INTEGER,
  ADD COLUMN "missingInputs" INTEGER,
  ADD COLUMN "discoveryDurationMs" INTEGER,
  ADD COLUMN "hashDurationMs" INTEGER,
  ADD COLUMN "publishDurationMs" INTEGER;

ALTER TABLE "scan_runs"
  ADD COLUMN "inventoryBaselineGeneration" INTEGER;

ALTER TABLE "scan_run_metadata_inputs"
  ADD COLUMN "sizeBytes" BIGINT,
  ADD COLUMN "mtimeMs" BIGINT,
  ADD COLUMN "ctimeMs" BIGINT,
  ADD COLUMN "deviceId" BIGINT,
  ADD COLUMN "inode" BIGINT;

ALTER TABLE "scan_run_items"
  ADD COLUMN "inventoryDecision" VARCHAR(40);

CREATE TABLE "pixiv_metadata_inventory_state" (
  "id" VARCHAR(40) NOT NULL DEFAULT 'pixiv',
  "status" "PixivMetadataInventoryStatus" NOT NULL DEFAULT 'INITIALIZING',
  "rootPathHash" VARCHAR(64) NOT NULL,
  "baselineGeneration" INTEGER NOT NULL DEFAULT 1,
  "baselineStartedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "baselineCompletedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pixiv_metadata_inventory_state_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pixiv_inventory_state_singleton_check" CHECK ("id" = 'pixiv'),
  CONSTRAINT "pixiv_inventory_state_root_hash_check" CHECK ("rootPathHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "pixiv_inventory_state_generation_check" CHECK ("baselineGeneration" >= 1),
  CONSTRAINT "pixiv_inventory_state_ready_time_check" CHECK (
    "status" <> 'READY' OR "baselineCompletedAt" IS NOT NULL
  )
);

CREATE TABLE "pixiv_metadata_inventory" (
  "id" TEXT NOT NULL,
  "relativePath" TEXT NOT NULL,
  "externalId" TEXT,
  "sizeBytes" BIGINT NOT NULL,
  "mtimeMs" BIGINT NOT NULL,
  "ctimeMs" BIGINT,
  "deviceId" BIGINT,
  "inode" BIGINT,
  "observedContentHash" VARCHAR(64),
  "processedContentHash" VARCHAR(64),
  "lastAttemptedContentHash" VARCHAR(64),
  "externalRefId" TEXT,
  "baselineGeneration" INTEGER NOT NULL DEFAULT 1,
  "baselineEligible" BOOLEAN NOT NULL DEFAULT false,
  "lastSeenScanRunId" VARCHAR(30),
  "lastAttemptedAt" TIMESTAMP(3),
  "lastProcessedAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "lastErrorSummary" TEXT,
  "lastErrorRetryable" BOOLEAN,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pixiv_metadata_inventory_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pixiv_inventory_size_check" CHECK ("sizeBytes" >= 0),
  CONSTRAINT "pixiv_inventory_mtime_check" CHECK ("mtimeMs" >= 0),
  CONSTRAINT "pixiv_inventory_generation_check" CHECK ("baselineGeneration" >= 1),
  CONSTRAINT "pixiv_inventory_observed_hash_check" CHECK (
    "observedContentHash" IS NULL OR "observedContentHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "pixiv_inventory_processed_hash_check" CHECK (
    "processedContentHash" IS NULL OR "processedContentHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "pixiv_inventory_attempted_hash_check" CHECK (
    "lastAttemptedContentHash" IS NULL OR "lastAttemptedContentHash" ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "pixiv_metadata_inventory_relativePath_key"
  ON "pixiv_metadata_inventory"("relativePath");
CREATE INDEX "pixiv_metadata_inventory_externalId_idx"
  ON "pixiv_metadata_inventory"("externalId");
CREATE INDEX "pixiv_metadata_inventory_externalRefId_idx"
  ON "pixiv_metadata_inventory"("externalRefId");
CREATE INDEX "pixiv_metadata_inventory_lastSeenScanRunId_idx"
  ON "pixiv_metadata_inventory"("lastSeenScanRunId");
CREATE INDEX "pixiv_metadata_inventory_retry_updated_idx"
  ON "pixiv_metadata_inventory"("lastErrorRetryable", "updatedAt");

ALTER TABLE "pixiv_metadata_inventory"
  ADD CONSTRAINT "pixiv_metadata_inventory_externalRefId_fkey"
  FOREIGN KEY ("externalRefId") REFERENCES "artwork_external_refs"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "scan_runs"
  ADD CONSTRAINT "scan_runs_inventory_metrics_nonnegative_check" CHECK (
    ("walkedEntries" IS NULL OR "walkedEntries" >= 0) AND
    ("metadataCandidates" IS NULL OR "metadataCandidates" >= 0) AND
    ("inventoryUnchanged" IS NULL OR "inventoryUnchanged" >= 0) AND
    ("contentHashed" IS NULL OR "contentHashed" >= 0) AND
    ("contentChanged" IS NULL OR "contentChanged" >= 0) AND
    ("parsedInputs" IS NULL OR "parsedInputs" >= 0) AND
    ("publishedInputs" IS NULL OR "publishedInputs" >= 0) AND
    ("failedInputs" IS NULL OR "failedInputs" >= 0) AND
    ("missingInputs" IS NULL OR "missingInputs" >= 0) AND
    ("discoveryDurationMs" IS NULL OR "discoveryDurationMs" >= 0) AND
    ("hashDurationMs" IS NULL OR "hashDurationMs" >= 0) AND
    ("publishDurationMs" IS NULL OR "publishDurationMs" >= 0)
    AND ("inventoryBaselineGeneration" IS NULL OR "inventoryBaselineGeneration" >= 1)
  ) NOT VALID;

ALTER TABLE "scan_runs"
  VALIDATE CONSTRAINT "scan_runs_inventory_metrics_nonnegative_check";

ALTER TABLE "scan_run_metadata_inputs"
  ADD CONSTRAINT "scan_metadata_inputs_stat_check" CHECK (
    ("sizeBytes" IS NULL OR "sizeBytes" >= 0) AND
    ("mtimeMs" IS NULL OR "mtimeMs" >= 0)
  ) NOT VALID;

ALTER TABLE "scan_run_metadata_inputs"
  VALIDATE CONSTRAINT "scan_metadata_inputs_stat_check";

ALTER TABLE "scan_run_items"
  ADD CONSTRAINT "scan_run_items_inventory_decision_check" CHECK (
    "inventoryDecision" IS NULL OR
    "inventoryDecision" IN ('BASELINE_EXISTING', 'PENDING_SOURCE_REFRESH')
  ) NOT VALID;

ALTER TABLE "scan_run_items"
  VALIDATE CONSTRAINT "scan_run_items_inventory_decision_check";
