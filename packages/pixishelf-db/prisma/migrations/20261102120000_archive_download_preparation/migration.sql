-- Preparation is consumed atomically by the matching Worker before downloading.
ALTER TABLE "archive_import_executions" ADD COLUMN "pendingDownloadPreparation" JSONB;

DROP TRIGGER artist_job_enqueue_lock ON system_jobs;

CREATE OR REPLACE FUNCTION guard_artist_job_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command JSONB; snapshot INTEGER[]; artist_id INTEGER;
BEGIN
  IF NEW.type = 'ARCHIVE_DOWNLOAD' THEN RETURN NEW; END IF;
  IF NEW.status::TEXT IN ('PENDING', 'RUNNING', 'RETRY_WAIT') AND
     (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.payload IS DISTINCT FROM NEW.payload) THEN
    PERFORM pg_advisory_xact_lock(7341902118);
    PERFORM assert_artist_command(NEW.payload);
    IF NEW.type = 'CREATOR_MAINTENANCE' THEN
      SELECT input INTO command FROM creator_maintenance_plans WHERE id = NEW.payload->>'planId';
      PERFORM assert_artist_command(command);
    END IF;
    SELECT "defaultCreatorIds" INTO snapshot FROM archive_uploader_scan_runs WHERE "systemJobId" = NEW.id;
    IF snapshot IS NOT NULL THEN FOREACH artist_id IN ARRAY snapshot LOOP PERFORM assert_available_artist(artist_id); END LOOP; END IF;
  END IF;
  RETURN NEW;
END $$;
