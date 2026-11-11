BEGIN;

CREATE TABLE "admin_realtime_revisions" (
  "resource" TEXT PRIMARY KEY,
  "revision" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "admin_realtime_resource_check" CHECK ("resource" IN ('archiveInbox', 'jobDashboard'))
);
INSERT INTO "admin_realtime_revisions" ("resource") VALUES ('archiveInbox'), ('jobDashboard');

CREATE INDEX "archive_intake_items_status_expiresAt_idx" ON "archive_intake_items" ("status", "expiresAt");
CREATE INDEX "archive_intake_items_status_updatedAt_idx" ON "archive_intake_items" ("status", "updatedAt");

-- Transition tables advance a resource once per statement, in the business transaction.
CREATE FUNCTION advance_admin_realtime_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF TG_TABLE_NAME = 'archive_uploader_catalog_items' THEN
      SELECT EXISTS (SELECT 1 FROM new_rows WHERE "lastIntakeItemId" IS NOT NULL) INTO changed;
    ELSE
      SELECT EXISTS (SELECT 1 FROM new_rows) INTO changed;
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'archive_uploader_catalog_items' THEN
      SELECT EXISTS (SELECT 1 FROM old_rows WHERE "lastIntakeItemId" IS NOT NULL) INTO changed;
    ELSE
      SELECT EXISTS (SELECT 1 FROM old_rows) INTO changed;
    END IF;
  ELSIF TG_TABLE_NAME = 'archive_uploader_catalog_items' THEN
    SELECT EXISTS (
      SELECT 1 FROM old_rows o JOIN new_rows n USING (id)
      WHERE (o."lastIntakeItemId" IS NOT NULL OR n."lastIntakeItemId" IS NOT NULL)
        AND ROW(o."lastIntakeItemId", o."comparisonSnapshot"->'fileSize', o."comparisonSnapshot"->'fileCount', o."lastSeenAt")
          IS DISTINCT FROM ROW(n."lastIntakeItemId", n."comparisonSnapshot"->'fileSize', n."comparisonSnapshot"->'fileCount', n."lastSeenAt")
    ) INTO changed;
  ELSIF TG_TABLE_NAME = 'archive_imports' THEN
    SELECT EXISTS (
      SELECT 1 FROM old_rows o JOIN new_rows n USING (id)
      WHERE ROW(o.status, o."publishedArtworkDeletedAt") IS DISTINCT FROM ROW(n.status, n."publishedArtworkDeletedAt")
    ) INTO changed;
  ELSIF TG_TABLE_NAME = 'archive_resolve_queue_control' THEN
    SELECT EXISTS (
      SELECT 1 FROM old_rows o JOIN new_rows n USING (id)
      WHERE ROW(o.paused, o."pausedAt") IS DISTINCT FROM ROW(n.paused, n."pausedAt")
    ) INTO changed;
  ELSE
    SELECT EXISTS (SELECT 1 FROM new_rows) INTO changed;
  END IF;
  IF changed THEN
    UPDATE admin_realtime_revisions SET revision = revision + 1 WHERE resource = TG_ARGV[0];
  END IF;
  RETURN NULL;
END $$;

CREATE TRIGGER archive_intake_items_realtime_insert AFTER INSERT ON "archive_intake_items"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('archiveInbox');
CREATE TRIGGER archive_intake_items_realtime_update AFTER UPDATE ON "archive_intake_items"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('archiveInbox');
CREATE TRIGGER archive_intake_items_realtime_delete AFTER DELETE ON "archive_intake_items"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('archiveInbox');
CREATE TRIGGER archive_resolve_queue_control_realtime_insert AFTER INSERT ON "archive_resolve_queue_control"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('archiveInbox');
CREATE TRIGGER archive_resolve_queue_control_realtime_update AFTER UPDATE ON "archive_resolve_queue_control"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('archiveInbox');
CREATE TRIGGER archive_resolve_queue_control_realtime_delete AFTER DELETE ON "archive_resolve_queue_control"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('archiveInbox');
CREATE TRIGGER archive_uploader_catalog_items_realtime_insert AFTER INSERT ON "archive_uploader_catalog_items"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('archiveInbox');
CREATE TRIGGER archive_uploader_catalog_items_realtime_update AFTER UPDATE ON "archive_uploader_catalog_items"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('archiveInbox');
CREATE TRIGGER archive_uploader_catalog_items_realtime_delete AFTER DELETE ON "archive_uploader_catalog_items"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('archiveInbox');
CREATE TRIGGER system_job_failure_acknowledgements_realtime_insert AFTER INSERT ON "system_job_failure_acknowledgements"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('jobDashboard');
CREATE TRIGGER system_job_failure_acknowledgements_realtime_update AFTER UPDATE ON "system_job_failure_acknowledgements"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('jobDashboard');
CREATE TRIGGER system_job_failure_acknowledgements_realtime_delete AFTER DELETE ON "system_job_failure_acknowledgements"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('jobDashboard');
CREATE TRIGGER archive_imports_realtime_insert AFTER INSERT ON "archive_imports"
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('jobDashboard');
CREATE TRIGGER archive_imports_realtime_update AFTER UPDATE ON "archive_imports"
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('jobDashboard');
CREATE TRIGGER archive_imports_realtime_delete AFTER DELETE ON "archive_imports"
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION advance_admin_realtime_revision('jobDashboard');

COMMIT;

