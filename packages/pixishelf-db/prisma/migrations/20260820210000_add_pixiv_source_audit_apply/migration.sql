-- Expand ScanRun with nullable apply provenance and aggregates so older clients remain compatible.
ALTER TABLE "scan_runs"
  ADD COLUMN "sourceAuditRunId" VARCHAR(30),
  ADD COLUMN "auditApplyStaleInputs" INTEGER,
  ADD COLUMN "auditApplyConflictInputs" INTEGER;

ALTER TABLE "scan_runs"
  ADD CONSTRAINT "scan_runs_audit_apply_counts_check"
  CHECK (
    ("auditApplyStaleInputs" IS NULL OR "auditApplyStaleInputs" >= 0) AND
    ("auditApplyConflictInputs" IS NULL OR "auditApplyConflictInputs" >= 0)
  ) NOT VALID,
  ADD CONSTRAINT "scan_runs_audit_apply_source_check"
  CHECK ("operationKind" IS DISTINCT FROM 'AUDIT_APPLY' OR "sourceAuditRunId" IS NOT NULL) NOT VALID;

ALTER TABLE "scan_runs" VALIDATE CONSTRAINT "scan_runs_audit_apply_counts_check";
ALTER TABLE "scan_runs" VALIDATE CONSTRAINT "scan_runs_audit_apply_source_check";

CREATE INDEX "scan_runs_source_audit_created_idx"
  ON "scan_runs"("sourceAuditRunId", "createdAt");

-- Freeze the remaining audit identity evidence on each apply input. These are snapshots, not domain FKs.
ALTER TABLE "scan_run_metadata_inputs"
  ADD COLUMN "observedExternalId" VARCHAR(255),
  ADD COLUMN "expectedProcessedContentHash" VARCHAR(64);

ALTER TABLE "scan_run_metadata_inputs"
  ADD CONSTRAINT "scan_metadata_inputs_expected_processed_hash_check"
  CHECK (
    "expectedProcessedContentHash" IS NULL OR
    "expectedProcessedContentHash" ~ '^[a-f0-9]{64}$'
  ) NOT VALID;

ALTER TABLE "scan_run_metadata_inputs"
  VALIDATE CONSTRAINT "scan_metadata_inputs_expected_processed_hash_check";

-- Apply item fields are nullable so existing ScanRunItem writers and historical rows require no rewrite.
ALTER TABLE "scan_run_items"
  ADD COLUMN "sourceAuditItemId" VARCHAR(30),
  ADD COLUMN "auditDifferenceKind" VARCHAR(32),
  ADD COLUMN "applyOutcome" VARCHAR(32),
  ADD COLUMN "resultArtworkId" INTEGER,
  ADD COLUMN "applyReasonCode" VARCHAR(80),
  ADD COLUMN "applyReasonSummary" TEXT,
  ADD COLUMN "applyRetryable" BOOLEAN;

ALTER TABLE "scan_run_items"
  ADD CONSTRAINT "scan_run_items_audit_difference_kind_check"
  CHECK ("auditDifferenceKind" IS NULL OR "auditDifferenceKind" IN ('NEW', 'CHANGED')) NOT VALID,
  ADD CONSTRAINT "scan_run_items_apply_outcome_check"
  CHECK ("applyOutcome" IS NULL OR "applyOutcome" IN ('APPLIED', 'SKIPPED', 'CONFLICT', 'FAILED')) NOT VALID,
  ADD CONSTRAINT "scan_run_items_apply_evidence_check"
  CHECK (
    (
      "sourceAuditItemId" IS NULL AND "auditDifferenceKind" IS NULL AND "applyOutcome" IS NULL AND
      "applyReasonCode" IS NULL AND "applyReasonSummary" IS NULL AND "applyRetryable" IS NULL AND
      "resultArtworkId" IS NULL
    ) OR (
      "sourceAuditItemId" IS NOT NULL AND "auditDifferenceKind" IN ('NEW', 'CHANGED') AND
      ("resultArtworkId" IS NULL OR "resultArtworkId" > 0) AND
      (
        (
          "applyOutcome" IS NULL AND "applyReasonCode" IS NULL AND "applyReasonSummary" IS NULL AND
          "applyRetryable" IS NULL AND "resultArtworkId" IS NULL
        ) OR
        ("applyOutcome" IS NOT NULL AND "applyRetryable" IS NOT NULL)
      )
    )
  ) NOT VALID;

ALTER TABLE "scan_run_items" VALIDATE CONSTRAINT "scan_run_items_audit_difference_kind_check";
ALTER TABLE "scan_run_items" VALIDATE CONSTRAINT "scan_run_items_apply_outcome_check";
ALTER TABLE "scan_run_items" VALIDATE CONSTRAINT "scan_run_items_apply_evidence_check";

CREATE UNIQUE INDEX "scan_run_items_run_source_audit_item_key"
  ON "scan_run_items"("scanRunId", "sourceAuditItemId");
CREATE INDEX "scan_run_items_source_audit_created_idx"
  ON "scan_run_items"("sourceAuditItemId", "createdAt");
