BEGIN;

-- Existing enum extensions are isolated from the structural migration because
-- PostgreSQL does not allow a newly added enum value to be used before commit.
ALTER TYPE "ScanRunStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "ScanRunStatus" ADD VALUE IF NOT EXISTS 'PAUSED';
ALTER TYPE "ScanRunStatus" ADD VALUE IF NOT EXISTS 'RETRY_WAIT';

ALTER TYPE "ScanRunItemStatus" ADD VALUE IF NOT EXISTS 'PENDING';
ALTER TYPE "ScanRunItemStatus" ADD VALUE IF NOT EXISTS 'PROCESSING';
ALTER TYPE "ScanRunItemStatus" ADD VALUE IF NOT EXISTS 'RETRY_WAIT';

ALTER TYPE "PendingReplaceBatchStatus" ADD VALUE IF NOT EXISTS 'DISCOVERING';
ALTER TYPE "PendingReplaceBatchStatus" ADD VALUE IF NOT EXISTS 'FAILED';

ALTER TYPE "PendingReplaceItemStatus" ADD VALUE IF NOT EXISTS 'ARCHIVING';
ALTER TYPE "PendingReplaceItemStatus" ADD VALUE IF NOT EXISTS 'RESTORE_COMMITTED';
ALTER TYPE "PendingReplaceItemStatus" ADD VALUE IF NOT EXISTS 'CLEANING_BACKUP';

COMMIT;
