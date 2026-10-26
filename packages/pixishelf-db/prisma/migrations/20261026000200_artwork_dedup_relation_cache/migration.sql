-- Completed run evidence is an optional cache; historical runs intentionally remain misses.
ALTER TABLE "ArtworkDedupRun"
  ADD COLUMN "relationCacheVersion" TEXT,
  ADD COLUMN "visualCandidatePairs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "originalReusedPairs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "originalComparedPairs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "visualReusedComparisons" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "visualComparedComparisons" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ArtworkDedupItem" ADD COLUMN "visualSignature" TEXT;
ALTER TABLE "ArtworkDedupRun" ADD CONSTRAINT artwork_dedup_relation_cache_bounds CHECK (
  cardinality("visualCandidatePairs") <= 1000 AND
  "originalReusedPairs" >= 0 AND "originalComparedPairs" >= 0 AND
  "visualReusedComparisons" >= 0 AND "visualReusedComparisons" <= 200000 AND
  "visualComparedComparisons" >= 0 AND "visualComparedComparisons" <= 200000
);
