CREATE TYPE "ArchiveLifecycleState" AS ENUM ('ACTIVE', 'TRASHING', 'TRASHED', 'RESTORING');

ALTER TABLE "Artwork"
  ADD COLUMN "archiveLifecycleState" "ArchiveLifecycleState" NOT NULL DEFAULT 'ACTIVE';

CREATE INDEX "Artwork_archiveLifecycleState_idx" ON "Artwork"("archiveLifecycleState");

ALTER TABLE "archive_imports"
  ADD COLUMN "cleanupRequestedAt" TIMESTAMP(3);

CREATE INDEX "archive_imports_cleanupRequestedAt_idx"
  ON "archive_imports"("cleanupRequestedAt");

-- A deployment may already contain rows trashed by the first archive implementation.
-- Mark every revision with a durable target and let the worker finish moving any
-- historical revisions that were left in the published tree.
UPDATE "archive_revisions" AS revision
SET
  "trashPath" = COALESCE(
    revision."trashPath",
    '.trash/archive/' || revision."artworkId"::text || '/' || revision."id"
  ),
  "trashedAt" = COALESCE(revision."trashedAt", artwork."deletedAt"),
  "purgeAfter" = COALESCE(revision."purgeAfter", artwork."deletedAt" + INTERVAL '7 days')
FROM "Artwork" AS artwork
WHERE artwork."id" = revision."artworkId"
  AND artwork."createdVia" = 'URL_ARCHIVE'
  AND artwork."deletedAt" IS NOT NULL;

UPDATE "Artwork"
SET "archiveLifecycleState" = 'TRASHING'
WHERE "createdVia" = 'URL_ARCHIVE'
  AND "deletedAt" IS NOT NULL;
