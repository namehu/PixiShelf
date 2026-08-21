-- Expand ScanRun with nullable operation and audit aggregates. Existing writers remain compatible.
ALTER TABLE "scan_runs"
  ADD COLUMN "operationKind" VARCHAR(40),
  ADD COLUMN "auditNewInputs" INTEGER,
  ADD COLUMN "auditChangedInputs" INTEGER,
  ADD COLUMN "auditInvalidInputs" INTEGER,
  ADD COLUMN "auditIdentityConflictInputs" INTEGER;

ALTER TABLE "scan_runs"
  ADD CONSTRAINT "scan_runs_operation_kind_check"
  CHECK ("operationKind" IS NULL OR "operationKind" IN ('CONSISTENCY_AUDIT', 'AUDIT_APPLY')) NOT VALID,
  ADD CONSTRAINT "scan_runs_audit_counts_nonnegative_check"
  CHECK (
    ("auditNewInputs" IS NULL OR "auditNewInputs" >= 0) AND
    ("auditChangedInputs" IS NULL OR "auditChangedInputs" >= 0) AND
    ("auditInvalidInputs" IS NULL OR "auditInvalidInputs" >= 0) AND
    ("auditIdentityConflictInputs" IS NULL OR "auditIdentityConflictInputs" >= 0)
  ) NOT VALID;

ALTER TABLE "scan_runs" VALIDATE CONSTRAINT "scan_runs_operation_kind_check";
ALTER TABLE "scan_runs" VALIDATE CONSTRAINT "scan_runs_audit_counts_nonnegative_check";

-- Apply inputs retain the exact audit evidence selected by a future producer. Snapshot IDs are not domain FKs.
ALTER TABLE "scan_run_metadata_inputs"
  ADD COLUMN "sourceAuditItemId" VARCHAR(30),
  ADD COLUMN "auditDifferenceKind" VARCHAR(32),
  ADD COLUMN "expectedExternalId" VARCHAR(255),
  ADD COLUMN "expectedInventoryId" VARCHAR(30),
  ADD COLUMN "expectedExternalRefId" VARCHAR(30),
  ADD COLUMN "expectedArtworkId" INTEGER;

ALTER TABLE "scan_run_metadata_inputs"
  ADD CONSTRAINT "scan_metadata_inputs_audit_difference_kind_check"
  CHECK (
    "auditDifferenceKind" IS NULL OR
    "auditDifferenceKind" IN ('NEW', 'CHANGED', 'MISSING', 'INVALID', 'IDENTITY_CONFLICT', 'UNCHANGED')
  ) NOT VALID;

ALTER TABLE "scan_run_metadata_inputs"
  VALIDATE CONSTRAINT "scan_metadata_inputs_audit_difference_kind_check";

ALTER TABLE "pixiv_metadata_inventory_state"
  ADD COLUMN "rootDeviceId" BIGINT,
  ADD COLUMN "rootInode" BIGINT;

ALTER TABLE "pixiv_metadata_inventory_state"
  ADD CONSTRAINT "pixiv_inventory_state_root_identity_check"
  CHECK (
    ("rootDeviceId" IS NULL AND "rootInode" IS NULL) OR
    ("rootDeviceId" IS NOT NULL AND "rootDeviceId" >= 0 AND "rootInode" IS NOT NULL AND "rootInode" >= 0)
  ) NOT VALID;

ALTER TABLE "pixiv_metadata_inventory_state"
  VALIDATE CONSTRAINT "pixiv_inventory_state_root_identity_check";

ALTER TABLE "pixiv_metadata_inventory"
  ADD COLUMN "lastSeenAuditRunId" VARCHAR(30);

CREATE INDEX "pixiv_metadata_inventory_last_audit_idx"
  ON "pixiv_metadata_inventory"("lastSeenAuditRunId");

CREATE TABLE "pixiv_source_audit_items" (
  "id" TEXT NOT NULL,
  "scanRunId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "differenceKind" VARCHAR(32) NOT NULL,
  "relativePath" TEXT NOT NULL,
  "expectedExternalId" VARCHAR(255),
  "observedExternalId" VARCHAR(255),
  "title" TEXT,
  "artistName" TEXT,
  "inventoryId" VARCHAR(30),
  "externalRefId" VARCHAR(30),
  "artworkId" INTEGER,
  "observedContentHash" VARCHAR(64),
  "processedContentHash" VARCHAR(64),
  "sizeBytes" BIGINT,
  "mtimeMs" BIGINT,
  "ctimeMs" BIGINT,
  "deviceId" BIGINT,
  "inode" BIGINT,
  "issueCode" VARCHAR(80),
  "issueSummary" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "pixiv_source_audit_items_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "pixiv_source_audit_items_difference_kind_check"
    CHECK ("differenceKind" IN ('NEW', 'CHANGED', 'MISSING', 'INVALID', 'IDENTITY_CONFLICT')),
  CONSTRAINT "pixiv_source_audit_items_observed_hash_check"
    CHECK ("observedContentHash" IS NULL OR "observedContentHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "pixiv_source_audit_items_processed_hash_check"
    CHECK ("processedContentHash" IS NULL OR "processedContentHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "pixiv_source_audit_items_stat_check"
    CHECK (
      ("sizeBytes" IS NULL OR "sizeBytes" >= 0) AND
      ("mtimeMs" IS NULL OR "mtimeMs" >= 0) AND
      ("ctimeMs" IS NULL OR "ctimeMs" >= 0) AND
      ("deviceId" IS NULL OR "deviceId" >= 0) AND
      ("inode" IS NULL OR "inode" >= 0)
    )
);

CREATE UNIQUE INDEX "pixiv_source_audit_items_run_ordinal_key"
  ON "pixiv_source_audit_items"("scanRunId", "ordinal");
CREATE UNIQUE INDEX "pixiv_source_audit_items_run_path_key"
  ON "pixiv_source_audit_items"("scanRunId", "relativePath");
CREATE INDEX "pixiv_source_audit_items_run_kind_ordinal_idx"
  ON "pixiv_source_audit_items"("scanRunId", "differenceKind", "ordinal");
CREATE INDEX "pixiv_source_audit_items_expectedExternalId_idx"
  ON "pixiv_source_audit_items"("expectedExternalId");

ALTER TABLE "pixiv_source_audit_items"
  ADD CONSTRAINT "pixiv_source_audit_items_scanRunId_fkey"
  FOREIGN KEY ("scanRunId") REFERENCES "scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
