-- Observation only: historical download URLs are intentionally left unknown.
ALTER TABLE "archive_import_items"
  ADD COLUMN "lastDownloadUrl" TEXT,
  ADD COLUMN "lastDownloadAt" TIMESTAMP(3),
  ADD COLUMN "lastDownloadAttempt" INTEGER;
