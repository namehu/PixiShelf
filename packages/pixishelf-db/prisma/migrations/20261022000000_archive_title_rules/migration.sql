BEGIN;
CREATE TYPE "ArchiveTitleReviewDecision" AS ENUM ('AUTO', 'INCLUDE', 'EXCLUDE');
CREATE TYPE "ArchiveTitleRuleRevisionStatus" AS ENUM ('PENDING', 'READY', 'STALE', 'APPLIED', 'CANCELLED');

ALTER TABLE "archive_uploader_sources" ADD COLUMN "titleRules" JSONB,
  ADD COLUMN "rulesVersion" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "catalogVersion" BIGINT NOT NULL DEFAULT 0;
ALTER TABLE "archive_uploader_scan_runs" ADD COLUMN "titleRules" JSONB, ADD COLUMN "rulesVersion" INTEGER;
ALTER TABLE "archive_uploader_catalog_items"
  ADD COLUMN "ruleMatches" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "uploaderMatches" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "reviewDecision" "ArchiveTitleReviewDecision" NOT NULL DEFAULT 'AUTO',
  ADD COLUMN "reviewedByUserId" TEXT, ADD COLUMN "reviewedAt" TIMESTAMP(3),
  ADD COLUMN "matchTitles" JSONB, ADD COLUMN "matchEvaluation" JSONB;

-- Preserve existing decisions and query keys. A rule preview explicitly reevaluates historical evidence.
UPDATE "archive_uploader_sources" SET "titleRules" = jsonb_build_object(
  'version', 1, 'any', jsonb_build_array(jsonb_build_object(
    'operator', COALESCE("titleQuery"->>'matchMode', 'CONTAINS'), 'text', "titleQuery"->>'keyword')),
  'all', '[]'::jsonb, 'none', '[]'::jsonb)
WHERE "sourceKind" = 'TITLE_QUERY';
UPDATE "archive_uploader_catalog_items" SET "ruleMatches" = "matchesQuery";

CREATE TABLE "archive_title_rule_revisions" (
  "id" TEXT PRIMARY KEY, "sourceId" TEXT NOT NULL, "systemJobId" TEXT,
  "requestedByUserId" TEXT NOT NULL, "requestId" TEXT NOT NULL,
  "rules" JSONB NOT NULL, "baseRulesVersion" INTEGER NOT NULL, "baseCatalogVersion" BIGINT NOT NULL,
  "status" "ArchiveTitleRuleRevisionStatus" NOT NULL DEFAULT 'PENDING', "cursor" TEXT,
  "checkedCount" INTEGER NOT NULL DEFAULT 0, "acceptedCount" INTEGER NOT NULL DEFAULT 0,
  "filteredCount" INTEGER NOT NULL DEFAULT 0, "newlyAcceptedCount" INTEGER NOT NULL DEFAULT 0,
  "newlyFilteredCount" INTEGER NOT NULL DEFAULT 0, "manualCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "appliedAt" TIMESTAMP(3),
  CONSTRAINT "archive_title_rule_revisions_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "archive_uploader_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "archive_title_rule_revisions_systemJobId_fkey" FOREIGN KEY ("systemJobId") REFERENCES "system_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "archive_title_rule_revisions_systemJobId_key" ON "archive_title_rule_revisions"("systemJobId");
CREATE UNIQUE INDEX "archive_title_rule_revisions_requestId_key" ON "archive_title_rule_revisions"("requestId");
CREATE INDEX "archive_title_rule_revisions_sourceId_createdAt_idx" ON "archive_title_rule_revisions"("sourceId", "createdAt" DESC);
CREATE TABLE "archive_title_rule_evaluations" (
  "revisionId" TEXT NOT NULL, "catalogItemId" TEXT NOT NULL, "evaluation" JSONB NOT NULL,
  "accepted" BOOLEAN NOT NULL, "previouslyAccepted" BOOLEAN NOT NULL,
  "reviewDecision" "ArchiveTitleReviewDecision" NOT NULL,
  CONSTRAINT "archive_title_rule_evaluations_pkey" PRIMARY KEY ("revisionId", "catalogItemId"),
  CONSTRAINT "archive_title_rule_evaluations_revisionId_fkey" FOREIGN KEY ("revisionId") REFERENCES "archive_title_rule_revisions"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "archive_title_rule_evaluations_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "archive_uploader_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Statement triggers invalidate previews even when another workflow deletes or updates catalog rows.
-- A source is advanced once per statement, rather than once per row in a large apply operation.
CREATE FUNCTION archive_title_catalog_insert_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE archive_uploader_sources SET "catalogVersion" = "catalogVersion" + 1
  WHERE id IN (SELECT DISTINCT "sourceId" FROM inserted_catalog) AND "sourceKind" = 'TITLE_QUERY';
  RETURN NULL;
END $$;
CREATE FUNCTION archive_title_catalog_update_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE archive_uploader_sources SET "catalogVersion" = "catalogVersion" + 1
  WHERE id IN (SELECT "sourceId" FROM previous_catalog UNION SELECT "sourceId" FROM updated_catalog)
    AND "sourceKind" = 'TITLE_QUERY';
  RETURN NULL;
END $$;
CREATE FUNCTION archive_title_catalog_delete_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE archive_uploader_sources SET "catalogVersion" = "catalogVersion" + 1
  WHERE id IN (SELECT DISTINCT "sourceId" FROM deleted_catalog) AND "sourceKind" = 'TITLE_QUERY';
  RETURN NULL;
END $$;
CREATE TRIGGER archive_title_catalog_insert_version AFTER INSERT ON archive_uploader_catalog_items
  REFERENCING NEW TABLE AS inserted_catalog FOR EACH STATEMENT EXECUTE FUNCTION archive_title_catalog_insert_version();
CREATE TRIGGER archive_title_catalog_update_version AFTER UPDATE ON archive_uploader_catalog_items
  REFERENCING OLD TABLE AS previous_catalog NEW TABLE AS updated_catalog FOR EACH STATEMENT EXECUTE FUNCTION archive_title_catalog_update_version();
CREATE TRIGGER archive_title_catalog_delete_version AFTER DELETE ON archive_uploader_catalog_items
  REFERENCING OLD TABLE AS deleted_catalog FOR EACH STATEMENT EXECUTE FUNCTION archive_title_catalog_delete_version();

ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_type_execution_lane_check";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_type_execution_lane_check" CHECK (
  ("type" IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN', 'ARCHIVE_SEARCH_SCAN', 'ARCHIVE_DISCOVERY_BATCH_SCAN', 'ARCHIVE_TITLE_RULE_PREVIEW') AND "executionLane" = 'ARCHIVE_RESOLVE')
  OR ("type" NOT IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN', 'ARCHIVE_SEARCH_SCAN', 'ARCHIVE_DISCOVERY_BATCH_SCAN', 'ARCHIVE_TITLE_RULE_PREVIEW') AND "executionLane" = 'BACKGROUND_WRITER')
);
COMMIT;
