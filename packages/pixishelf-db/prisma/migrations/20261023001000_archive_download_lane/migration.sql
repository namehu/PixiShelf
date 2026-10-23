BEGIN;
CREATE TYPE "ArchiveImportPhase" AS ENUM ('LEGACY', 'DOWNLOAD', 'PUBLISH');
ALTER TABLE "archive_imports"
  ADD COLUMN "phase" "ArchiveImportPhase" NOT NULL DEFAULT 'LEGACY',
  ADD COLUMN "origin" "ArchiveIntakeDownloadMode",
  ADD COLUMN "generationToken" UUID,
  ADD COLUMN "sealedManifestSha256" VARCHAR(64);
ALTER TABLE "archive_import_items" ADD COLUMN "stagedGenerationPath" TEXT;
CREATE TABLE "archive_import_executions" (
  "jobId" TEXT PRIMARY KEY REFERENCES "system_jobs"("id") ON DELETE CASCADE,
  "archiveImportId" TEXT NOT NULL REFERENCES "archive_imports"("id") ON DELETE CASCADE,
  "phase" "ArchiveImportPhase" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "archive_import_executions_archiveImportId_createdAt_idx" ON "archive_import_executions"("archiveImportId", "createdAt");
INSERT INTO "archive_import_executions" ("jobId", "archiveImportId", "phase", "createdAt")
SELECT "systemJobId", "id", 'LEGACY', "createdAt" FROM "archive_imports";
CREATE TABLE "archive_staging_generations" (
  "token" UUID PRIMARY KEY,
  "archiveImportId" TEXT NOT NULL REFERENCES "archive_imports"("id") ON DELETE CASCADE,
  "jobId" TEXT NOT NULL REFERENCES "system_jobs"("id") ON DELETE RESTRICT,
  "path" TEXT NOT NULL,
  "manifestSha256" VARCHAR(64),
  "sealedAt" TIMESTAMP(3),
  "drainedAt" TIMESTAMP(3),
  "cleanedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "archive_staging_generations_archiveImportId_idx" ON "archive_staging_generations"("archiveImportId");
ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_type_execution_lane_check";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_type_execution_lane_check" CHECK (
  ("type" IN ('ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN', 'ARCHIVE_SEARCH_SCAN', 'ARCHIVE_DISCOVERY_BATCH_SCAN', 'ARCHIVE_TITLE_RULE_PREVIEW') AND "executionLane" = 'ARCHIVE_RESOLVE')
  OR ("type" = 'ARCHIVE_DOWNLOAD' AND "executionLane" = 'ARCHIVE_DOWNLOAD')
  OR ("type" NOT IN ('ARCHIVE_DOWNLOAD', 'ARCHIVE_RESOLVE_ITEM', 'ARCHIVE_UPLOADER_SCAN', 'ARCHIVE_SEARCH_SCAN', 'ARCHIVE_DISCOVERY_BATCH_SCAN', 'ARCHIVE_TITLE_RULE_PREVIEW') AND "executionLane" = 'BACKGROUND_WRITER')
);
CREATE FUNCTION preserve_system_job_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."type" IS DISTINCT FROM OLD."type" OR NEW."executionLane" IS DISTINCT FROM OLD."executionLane" THEN
    RAISE EXCEPTION 'SystemJob type and executionLane are immutable';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER system_jobs_immutable_identity BEFORE UPDATE ON "system_jobs"
FOR EACH ROW EXECUTE FUNCTION preserve_system_job_identity();
COMMIT;
