-- Exact URL equality in catalog-state lookups; Hash supports unbounded Text values.
CREATE INDEX "archive_intake_items_submitted_url_hash_idx"
ON "archive_intake_items" USING HASH ("submittedUrl");
CREATE INDEX "archive_intake_items_canonical_url_hash_idx"
ON "archive_intake_items" USING HASH ("canonicalUrl");
