-- Bind uploader sources to a stable numeric UID without rewriting their original
-- NAME/UID identity. Scan runs freeze the effective search identity for audit and
-- retry safety.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "archive_uploader_scan_runs"
    WHERE "status" IN ('PENDING', 'RUNNING', 'RETRY_WAIT', 'PAUSED')
  ) THEN
    RAISE EXCEPTION 'archive uploader UID binding migration requires all uploader scans to be terminal';
  END IF;
END
$$;

ALTER TABLE "archive_uploader_sources"
  ADD COLUMN "uploaderUid" VARCHAR(20),
  ADD COLUMN "uidRevalidationRequiredAt" TIMESTAMP(3);

UPDATE "archive_uploader_sources"
SET "uploaderUid" = "normalizedIdentity"
WHERE "identityKind" = 'UID';

CREATE UNIQUE INDEX "archive_uploader_sources_provider_uid_key"
  ON "archive_uploader_sources"("providerKey", "uploaderUid");

ALTER TABLE "archive_uploader_scan_runs"
  ADD COLUMN "searchIdentityKind" "ArchiveUploaderIdentityKind",
  ADD COLUMN "searchIdentityValue" VARCHAR(180);

UPDATE "archive_uploader_scan_runs" AS run
SET
  "searchIdentityKind" = source."identityKind",
  "searchIdentityValue" = source."identityValue"
FROM "archive_uploader_sources" AS source
WHERE source."id" = run."sourceId";

ALTER TABLE "archive_uploader_scan_runs"
  ALTER COLUMN "searchIdentityKind" SET NOT NULL,
  ALTER COLUMN "searchIdentityValue" SET NOT NULL;
