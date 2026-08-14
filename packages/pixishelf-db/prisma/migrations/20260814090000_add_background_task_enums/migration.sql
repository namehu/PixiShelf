-- Keep enum mutations separate from the schema migration. PostgreSQL cannot use a
-- newly-added enum value in the same transaction on supported deployment versions.
BEGIN;

CREATE TYPE "JobTriggerSource" AS ENUM (
    'MANUAL',
    'SCHEDULE',
    'SYSTEM',
    'RETRY',
    'LEGACY'
);

CREATE TYPE "JobSkipReason" AS ENUM (
    'WINDOW_EXPIRED',
    'DISABLED_BEFORE_START',
    'SUPERSEDED',
    'PRECONDITION_NOT_MET'
);

CREATE TYPE "JobEventLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

CREATE TYPE "GcEntryStatus" AS ENUM (
    'PENDING',
    'PROCESSING',
    'DELETED',
    'SKIPPED_REFERENCED',
    'FAILED'
);

ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'RETRY_WAIT' BEFORE 'COMPLETED';
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'SKIPPED';

COMMIT;
