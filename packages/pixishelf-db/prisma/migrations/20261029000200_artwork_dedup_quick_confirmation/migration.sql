ALTER TABLE "ArtworkDedupOperation" ADD COLUMN "preparationVersion" integer NOT NULL DEFAULT 1,
  ADD COLUMN "verifiedFiles" bigint NOT NULL DEFAULT 0,
  ADD COLUMN "verificationResume" jsonb;
ALTER TABLE "ArtworkDedupOperation" ADD CONSTRAINT "ArtworkDedupOperation_preparation_version"
  CHECK ("preparationVersion" IN (1,2) AND "verifiedFiles">=0 AND ("preparationVersion"=1 OR "preparePurpose"='DIRECT_DELETE'));
ALTER TABLE "ArtworkDedupOperationFile" ADD COLUMN "verificationSpec" jsonb;

ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_dedup_policy" CHECK (
  type NOT IN ('ARTWORK_DEDUP_SCAN','ARTWORK_DEDUP_MAINTENANCE') OR (
    "executionLane"='BACKGROUND_WRITER' AND "triggerSource"='SYSTEM'
    AND "queuePriority"=900 AND "effectivePriority"=900 AND "scheduledTaskId" IS NULL
    AND "parentJobId" IS NULL AND "deadlineAt" IS NULL
    AND (
      "definitionVersion"=1
      OR (type='ARTWORK_DEDUP_SCAN' AND "definitionVersion" IN(2,3,4,5,6,7))
      OR (type='ARTWORK_DEDUP_MAINTENANCE' AND "definitionVersion" IN(2,3,4,5,6) AND coalesce((
        jsonb_typeof(payload)='object'
        AND payload ?& ARRAY['operationId','executionVersion','mode']
        AND jsonb_typeof(payload->'operationId')='string'
        AND length(btrim(payload->>'operationId')) BETWEEN 1 AND 128
        AND jsonb_typeof(payload->'executionVersion')='number'
        AND CASE WHEN (payload->>'executionVersion') ~ '^[1-9][0-9]*$'
          THEN (payload->>'executionVersion')::numeric <= 9007199254740991 ELSE false END
        AND (
          (payload->'mode'='"DIRECT_DELETE"'::jsonb
            AND payload - ARRAY['operationId','executionVersion','mode']='{}'::jsonb)
          OR ("definitionVersion"<6 AND payload->'mode'='"PREPARE"'::jsonb
            AND payload->'purpose'='"DIRECT_DELETE"'::jsonb
            AND (payload->'protocolVersion'='1'::jsonb OR "definitionVersion">=3 AND payload->'protocolVersion'='2'::jsonb OR "definitionVersion">=4 AND payload->'protocolVersion'='3'::jsonb OR "definitionVersion">=5 AND payload->'protocolVersion'='4'::jsonb)
            AND payload - ARRAY['operationId','executionVersion','mode','purpose','protocolVersion']='{}'::jsonb)
        )
      ),false))
    )
  )
);
