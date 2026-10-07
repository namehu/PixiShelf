-- Phase 1 only: preserve old columns and writes so the v0.50.8 application can be restored.
BEGIN;
ALTER TABLE "system_jobs" ADD COLUMN "legacyDisplay" JSONB;
UPDATE "system_jobs"
SET "legacyDisplay" = jsonb_build_object(
  'schemaVersion', 1,
  'targetImageId', "targetImageId",
  'targetPath', "targetPath",
  'mode', "mode"
)
WHERE "definitionVersion" = 0;
CREATE INDEX "system_jobs_payload_image_created_idx"
  ON "system_jobs" ("type", ("payload" #> '{imageId}'), "createdAt" DESC, "id" DESC)
  WHERE "definitionVersion" > 0;
CREATE INDEX "system_jobs_legacy_image_created_idx"
  ON "system_jobs" ("type", ("legacyDisplay" #> '{targetImageId}'), "createdAt" DESC, "id" DESC)
  WHERE "definitionVersion" = 0;
COMMIT;
