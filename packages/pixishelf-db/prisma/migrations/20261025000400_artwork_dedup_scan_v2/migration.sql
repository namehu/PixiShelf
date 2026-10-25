-- New scans cannot be claimed by exact-only v1 Workers. Legacy v1 scans remain readable.
ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_dedup_policy" CHECK (
  type NOT IN ('ARTWORK_DEDUP_SCAN','ARTWORK_DEDUP_MAINTENANCE') OR (
    "executionLane"='BACKGROUND_WRITER' AND "triggerSource"='SYSTEM'
    AND "queuePriority"=900 AND "effectivePriority"=900 AND "scheduledTaskId" IS NULL
    AND "parentJobId" IS NULL AND "deadlineAt" IS NULL
    AND (
      "definitionVersion"=1
      OR (type='ARTWORK_DEDUP_SCAN' AND "definitionVersion"=2)
      OR (type='ARTWORK_DEDUP_MAINTENANCE' AND "definitionVersion" IN(2,3) AND coalesce((
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
          OR (payload->'mode'='"PREPARE"'::jsonb
            AND payload->'purpose'='"DIRECT_DELETE"'::jsonb
            AND (payload->'protocolVersion'='1'::jsonb OR "definitionVersion"=3 AND payload->'protocolVersion'='2'::jsonb)
            AND payload - ARRAY['operationId','executionVersion','mode','purpose','protocolVersion']='{}'::jsonb)
        )
      ),false))
    )
  )
);
