-- Scan v6 adds per-round permission without resetting cumulative work.
ALTER TABLE "ArtworkDedupRun"
  ADD COLUMN "visualComparisonRound" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "visualRoundStartComparisons" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "visualBudgetWaiting" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ArtworkDedupRun" DROP CONSTRAINT artwork_dedup_relation_cache_bounds;
ALTER TABLE "ArtworkDedupRun" ADD CONSTRAINT artwork_dedup_relation_cache_bounds CHECK (
  cardinality("visualCandidatePairs") <= 1000 AND
  "originalReusedPairs" >= 0 AND "originalComparedPairs" >= 0 AND
  "visualReusedComparisons" >= 0 AND "visualComparedComparisons" >= 0 AND
  "visualComparisonRound" >= 0 AND "visualRoundStartComparisons" >= 0 AND
  CASE WHEN "visualComparisonRound" = 0 THEN
    "visualRoundStartComparisons" = 0 AND NOT "visualBudgetWaiting" AND
    "visualReusedComparisons" <= 200000 AND "visualComparedComparisons" <= 200000
  ELSE
    "visualRoundStartComparisons"::bigint = ("visualComparisonRound"::bigint - 1) * 200000 AND
    "visualReusedComparisons"::bigint + "visualComparedComparisons"::bigint - "visualRoundStartComparisons"::bigint BETWEEN 0 AND 200000
  END AND
  (NOT "visualBudgetWaiting" OR (
    stage = 'VISUAL' AND "visualStatus" = 'PENDING' AND
    status IN ('PENDING','RUNNING','PAUSING','PAUSED','RETRY_WAIT','CANCELLING') AND
    "visualReusedComparisons"::bigint + "visualComparedComparisons"::bigint - "visualRoundStartComparisons"::bigint = 200000
  ))
);

-- Queue finalization and expired-lease recovery share this trigger. A terminal
-- failure/cancellation clears pending permission; completion must not hide an unfinished round.
CREATE OR REPLACE FUNCTION sync_artwork_dedup_job_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'ARTWORK_DEDUP_SCAN' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE "ArtworkDedupRun" SET status = CASE WHEN NEW.status = 'SKIPPED' THEN 'FAILED' ELSE NEW.status::text END,
      version = version + 1, "updatedAt" = NEW."updatedAt",
      "startedAt" = COALESCE("startedAt", NEW."startedAt"),
      "finishedAt" = NEW."finishedAt",
      "visualBudgetWaiting" = CASE WHEN NEW.status IN ('FAILED','SKIPPED','CANCELLED') THEN false ELSE "visualBudgetWaiting" END,
      "errorCode" = CASE WHEN NEW.status IN ('FAILED','SKIPPED') THEN COALESCE("errorCode",'DETECTION_FAILED') WHEN NEW.status = 'PAUSED' THEN "errorCode" ELSE NULL END
    WHERE "jobId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_dedup_policy" CHECK (
  type NOT IN ('ARTWORK_DEDUP_SCAN','ARTWORK_DEDUP_MAINTENANCE') OR (
    "executionLane"='BACKGROUND_WRITER' AND "triggerSource"='SYSTEM'
    AND "queuePriority"=900 AND "effectivePriority"=900 AND "scheduledTaskId" IS NULL
    AND "parentJobId" IS NULL AND "deadlineAt" IS NULL
    AND (
      "definitionVersion"=1
      OR (type='ARTWORK_DEDUP_SCAN' AND "definitionVersion" IN(2,3,4,5,6))
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
