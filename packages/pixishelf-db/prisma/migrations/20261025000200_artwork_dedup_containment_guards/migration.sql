ALTER TABLE "ArtworkDedupRun" DROP CONSTRAINT "ArtworkDedupRun_contract";
ALTER TABLE "ArtworkDedupOperation" DROP CONSTRAINT "ArtworkDedupOperation_direct_delete_contract";
ALTER TABLE "ArtworkDedupOperation" ADD CONSTRAINT "ArtworkDedupOperation_direct_delete_contract" CHECK (
 ("preparePurpose" <> 'DIRECT_DELETE' AND "protocolVersion" IS NULL AND "scopeDigest" IS NULL AND "directDeleteConfirmedAt" IS NULL AND "freshVerifiedExecutionVersion" IS NULL AND "deleteStartedAt" IS NULL AND mode <> 'DIRECT_DELETE')
 OR ("preparePurpose"='DIRECT_DELETE' AND "protocolVersion" IN (1,2)
   AND ("scopeDigest" IS NULL OR "scopeDigest" ~ '^[a-f0-9]{64}$')
   AND (mode <> 'DIRECT_DELETE' OR ("scopeDigest" IS NOT NULL AND "directDeleteConfirmedAt" IS NOT NULL AND "externalWritesStoppedAt" IS NOT NULL AND "authorizationDigest" IS NOT NULL))
   AND ("freshVerifiedExecutionVersion" IS NULL OR "freshVerifiedExecutionVersion">0)
   AND ("deleteStartedAt" IS NULL OR (mode='DIRECT_DELETE' AND "freshVerifiedExecutionVersion" IS NOT NULL)))
);
ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_dedup_policy" CHECK (
  type NOT IN ('ARTWORK_DEDUP_SCAN','ARTWORK_DEDUP_MAINTENANCE') OR (
    "executionLane"='BACKGROUND_WRITER' AND "triggerSource"='SYSTEM'
    AND "queuePriority"=900 AND "effectivePriority"=900 AND "scheduledTaskId" IS NULL
    AND "parentJobId" IS NULL AND "deadlineAt" IS NULL
    AND (
      "definitionVersion"=1
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
