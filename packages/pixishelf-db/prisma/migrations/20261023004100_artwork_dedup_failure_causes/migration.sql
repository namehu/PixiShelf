CREATE OR REPLACE FUNCTION sync_artwork_dedup_job_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'ARTWORK_DEDUP_SCAN' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE "ArtworkDedupRun" SET status = CASE WHEN NEW.status = 'SKIPPED' THEN 'FAILED' ELSE NEW.status::text END,
      version = version + 1, "updatedAt" = NEW."updatedAt",
      "startedAt" = COALESCE("startedAt", NEW."startedAt"),
      "finishedAt" = NEW."finishedAt",
      "errorCode" = CASE WHEN NEW.status IN ('FAILED','SKIPPED') THEN COALESCE("errorCode",'DETECTION_FAILED') WHEN NEW.status = 'PAUSED' THEN "errorCode" ELSE NULL END
    WHERE "jobId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
