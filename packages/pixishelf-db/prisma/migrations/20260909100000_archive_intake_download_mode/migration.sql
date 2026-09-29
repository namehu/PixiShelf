-- Existing intake rows remain manual; this migration does not activate work.
CREATE TYPE "ArchiveIntakeDownloadMode" AS ENUM ('MANUAL', 'AUTO');
ALTER TYPE "ArchiveIntakeStatus" ADD VALUE 'SKIPPED';
ALTER TABLE "archive_intake_items"
  ADD COLUMN "downloadMode" "ArchiveIntakeDownloadMode" NOT NULL DEFAULT 'MANUAL';
