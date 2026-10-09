-- Manual progress does not manufacture a visit or reading timestamps.
ALTER TABLE "artwork_reading_summaries"
  ALTER COLUMN "lastViewedAt" DROP NOT NULL,
  ALTER COLUMN "lastActiveAt" DROP NOT NULL,
  ADD COLUMN "stateVersion" INTEGER NOT NULL DEFAULT 0;
