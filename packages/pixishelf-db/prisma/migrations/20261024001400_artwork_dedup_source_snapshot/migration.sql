-- Nullable storage only: preserve legacy inputs as unproven, with no default or backfill.
ALTER TABLE "scan_run_metadata_inputs" ADD COLUMN "dedupSourceSnapshot" JSONB;
ALTER TABLE "scan_run_local_work_inputs" ADD COLUMN "dedupSourceSnapshot" JSONB;
ALTER TABLE "pixiv_source_audit_items" ADD COLUMN "dedupSourceSnapshot" JSONB;
ALTER TABLE "archive_intake_items" ADD COLUMN "dedupSourceSnapshot" JSONB;
ALTER TABLE "archive_imports" ADD COLUMN "dedupSourceSnapshot" JSONB;
