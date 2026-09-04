BEGIN;

-- Keep all uploader identities, cursors, catalog IDs and workflow references.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "archive_uploader_scan_runs" WHERE "status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED')) THEN
    RAISE EXCEPTION 'title search migration requires discovery scans to be terminal';
  END IF;
END $$;

CREATE TYPE "ArchiveDiscoverySourceKind" AS ENUM ('UPLOADER', 'TITLE_QUERY');
ALTER TABLE "archive_uploader_sources"
  ADD COLUMN "sourceKind" "ArchiveDiscoverySourceKind" NOT NULL DEFAULT 'UPLOADER',
  ADD COLUMN "titleQuery" JSONB,
  ADD COLUMN "queryKey" VARCHAR(64),
  ALTER COLUMN "identityKind" DROP NOT NULL,
  ALTER COLUMN "identityValue" DROP NOT NULL,
  ALTER COLUMN "normalizedIdentity" DROP NOT NULL;
CREATE UNIQUE INDEX "archive_uploader_sources_queryKey_key" ON "archive_uploader_sources"("queryKey");
ALTER TABLE "archive_uploader_sources" ADD CONSTRAINT "archive_discovery_source_shape_check" CHECK (
  ("sourceKind" = 'UPLOADER' AND "identityKind" IS NOT NULL AND "identityValue" IS NOT NULL AND "normalizedIdentity" IS NOT NULL AND "titleQuery" IS NULL AND "queryKey" IS NULL)
  OR ("sourceKind" = 'TITLE_QUERY' AND "titleQuery" IS NOT NULL AND jsonb_typeof("titleQuery") = 'object' AND "queryKey" IS NOT NULL AND "identityKind" IS NULL AND "identityValue" IS NULL AND "normalizedIdentity" IS NULL AND "uploaderUid" IS NULL AND "uidRevalidationRequiredAt" IS NULL)
);
ALTER TABLE "archive_uploader_scan_runs"
  ADD COLUMN "titleQuery" JSONB,
  ADD COLUMN "checkedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "matchedCount" INTEGER NOT NULL DEFAULT 0,
  ALTER COLUMN "searchIdentityKind" DROP NOT NULL,
  ALTER COLUMN "searchIdentityValue" DROP NOT NULL;
UPDATE "archive_uploader_scan_runs" SET "checkedCount" = "itemCount", "matchedCount" = "itemCount";
ALTER TABLE "archive_uploader_scan_runs" ADD CONSTRAINT "archive_discovery_run_query_check" CHECK (
  ("titleQuery" IS NULL AND "searchIdentityKind" IS NOT NULL AND "searchIdentityValue" IS NOT NULL)
  OR ("titleQuery" IS NOT NULL AND jsonb_typeof("titleQuery") = 'object' AND "searchIdentityKind" IS NULL AND "searchIdentityValue" IS NULL)
);
ALTER TABLE "archive_uploader_scan_runs" ADD CONSTRAINT "archive_discovery_run_counts_check" CHECK (
  "checkedCount" >= 0 AND "checkedCount" <= 100 AND "matchedCount" >= 0 AND "matchedCount" <= "checkedCount"
);
ALTER TABLE "archive_uploader_scan_items" ADD COLUMN "matchesQuery" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "archive_uploader_catalog_items" ADD COLUMN "matchesQuery" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_type_execution_lane_check";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_type_execution_lane_check" CHECK (
  ("type" IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN', 'ARCHIVE_SEARCH_SCAN') AND "executionLane" = 'ARCHIVE_RESOLVE')
  OR ("type" NOT IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN', 'ARCHIVE_SEARCH_SCAN') AND "executionLane" = 'BACKGROUND_WRITER')
);

COMMIT;
