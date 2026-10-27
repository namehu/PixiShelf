-- Legacy identity-bound caches stay usable without inferring a content key.
ALTER TABLE "MediaVisualFingerprint"
  ADD COLUMN "contentSha256" TEXT,
  ADD COLUMN "contentSize" BIGINT;

CREATE INDEX "MediaVisualFingerprint_content_key_idx" ON "MediaVisualFingerprint"
  ("contentSha256", "contentSize", "algorithmVersion", "normalizationVersion");
