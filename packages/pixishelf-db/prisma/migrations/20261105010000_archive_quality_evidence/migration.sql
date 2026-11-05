-- Additive evidence only: existing requested quality is deliberately not used as proof.
CREATE TYPE "ArchiveMediaQuality" AS ENUM ('ORIGINAL', 'DISPLAY', 'MIXED', 'UNKNOWN');
ALTER TABLE "archive_import_items" ADD COLUMN "deliveryEvidence" JSONB;
ALTER TABLE "archive_revisions"
  ADD COLUMN "qualityEvidence" JSONB,
  ADD COLUMN "qualityStatus" "ArchiveMediaQuality" NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN "qualityOriginalCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "qualityDisplayCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "qualityUnknownCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "qualityVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "qualityDefinitionVersion" INTEGER;

-- New requests default to display delivery; existing explicit preferences are preserved.
ALTER TABLE "archive_imports"
  ALTER COLUMN "requestedQuality" SET DEFAULT 'DISPLAY',
  ALTER COLUMN "selectedQuality" SET DEFAULT 'DISPLAY';
ALTER TABLE "archive_intake_items" ALTER COLUMN "selectedQuality" SET DEFAULT 'DISPLAY';
