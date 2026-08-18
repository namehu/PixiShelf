BEGIN;

-- Request fingerprints make idempotency semantic: the same key may replay the
-- same command, but it cannot be rebound to different URLs, targets, or options.
ALTER TABLE "archive_intake_submissions"
  ADD COLUMN "requestHash" VARCHAR(64);

ALTER TABLE "archive_bulk_operations"
  ADD COLUMN "requestHash" VARCHAR(64);

-- The preceding migration did not yet expose producers, but upgrade rehearsals
-- and tests may contain rows. Give them a stable legacy fingerprint before the
-- new application starts enforcing semantic replay.
UPDATE "archive_intake_submissions"
SET "requestHash" = md5("idempotencyKey") || md5('archive-intake:' || "idempotencyKey")
WHERE "requestHash" IS NULL;

UPDATE "archive_bulk_operations"
SET "requestHash" = md5("idempotencyKey") || md5('archive-bulk:' || "idempotencyKey")
WHERE "requestHash" IS NULL;

ALTER TABLE "archive_intake_submissions"
  ALTER COLUMN "requestHash" SET NOT NULL;

ALTER TABLE "archive_bulk_operations"
  ALTER COLUMN "requestHash" SET NOT NULL;

ALTER TABLE "archive_intake_submissions"
  ADD CONSTRAINT "archive_intake_submissions_request_hash_check"
  CHECK ("requestHash" ~ '^[a-f0-9]{64}$');

ALTER TABLE "archive_bulk_operations"
  ADD CONSTRAINT "archive_bulk_operations_request_hash_check"
  CHECK ("requestHash" ~ '^[a-f0-9]{64}$');

COMMIT;
