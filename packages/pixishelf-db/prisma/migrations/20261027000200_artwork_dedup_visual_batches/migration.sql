ALTER TABLE "ArtworkDedupRun" ADD COLUMN "visualCheckpoint" JSONB;
ALTER TABLE "ArtworkDedupItem" ADD COLUMN "visualReuseSignature" TEXT;
CREATE TABLE "ArtworkDedupVisualPosting" (
  "runId" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "imageId" INTEGER NOT NULL,
  "multiplicity" INTEGER NOT NULL CHECK ("multiplicity" BETWEEN 1 AND 4),
  CONSTRAINT "ArtworkDedupVisualPosting_pkey" PRIMARY KEY ("runId", "key", "imageId"),
  CONSTRAINT "ArtworkDedupVisualPosting_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ArtworkDedupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE TABLE "ArtworkDedupVisualCandidate" (
  "runId" TEXT NOT NULL,
  "leftArtworkId" INTEGER NOT NULL,
  "rightArtworkId" INTEGER NOT NULL,
  "edges" JSONB NOT NULL DEFAULT '[]',
  "evidence" JSONB,
  "reused" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ArtworkDedupVisualCandidate_pkey" PRIMARY KEY ("runId", "leftArtworkId", "rightArtworkId"),
  CONSTRAINT "ArtworkDedupVisualCandidate_order_check" CHECK ("leftArtworkId" < "rightArtworkId"),
  CONSTRAINT "ArtworkDedupVisualCandidate_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ArtworkDedupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ArtworkDedupMedia_runId_imageId_idx" ON "ArtworkDedupMedia"("runId", "imageId");

-- Scan v5 owns the durable visual checkpoint protocol; maintenance is unchanged.
ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_dedup_policy" CHECK (
  type NOT IN ('ARTWORK_DEDUP_SCAN','ARTWORK_DEDUP_MAINTENANCE') OR (
    "executionLane"='BACKGROUND_WRITER' AND "triggerSource"='SYSTEM'
    AND "queuePriority"=900 AND "effectivePriority"=900 AND "scheduledTaskId" IS NULL
    AND "parentJobId" IS NULL AND "deadlineAt" IS NULL
    AND (
      "definitionVersion"=1
      OR (type='ARTWORK_DEDUP_SCAN' AND "definitionVersion" IN(2,3,4,5))
      OR (type='ARTWORK_DEDUP_MAINTENANCE' AND "definitionVersion" IN(2,3,4,5) AND coalesce((
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
            AND (payload->'protocolVersion'='1'::jsonb OR "definitionVersion">=3 AND payload->'protocolVersion'='2'::jsonb OR "definitionVersion">=4 AND payload->'protocolVersion'='3'::jsonb OR "definitionVersion"=5 AND payload->'protocolVersion'='4'::jsonb)
            AND payload - ARRAY['operationId','executionVersion','mode','purpose','protocolVersion']='{}'::jsonb)
        )
      ),false))
    )
  )
);
