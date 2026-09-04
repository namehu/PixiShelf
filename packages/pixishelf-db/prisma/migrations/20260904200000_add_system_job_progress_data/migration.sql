ALTER TABLE "system_jobs"
ADD COLUMN "progressData" JSONB;

CREATE INDEX "system_job_events_type_level_createdAt_id_idx"
ON "system_job_events"("type", "level", "createdAt", "id");
