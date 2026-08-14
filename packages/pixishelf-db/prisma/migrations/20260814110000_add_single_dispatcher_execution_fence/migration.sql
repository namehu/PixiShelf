BEGIN;

-- The release runbook requires all old workers to be stopped with no active
-- jobs before this migration. Fail explicitly instead of silently accepting a
-- state that cannot satisfy the single-execution invariant.
DO $$
DECLARE
    executing_count INTEGER;
BEGIN
    SELECT COUNT(*)::INTEGER
      INTO executing_count
      FROM "system_jobs"
     WHERE "status" IN ('RUNNING', 'PAUSING', 'CANCELLING');

    IF executing_count > 0 THEN
        RAISE EXCEPTION
          'single dispatcher fence cannot be installed while % jobs are executing; drain all jobs and stop old workers first',
          executing_count;
    END IF;
END
$$;

-- Prisma cannot currently declare a PostgreSQL partial expression index in
-- schema.prisma. This database-level fence is intentionally migration-owned.
-- The persistent global/background-worker lease provides ownership and expiry;
-- this index is the final invariant if application or lease code regresses.
CREATE UNIQUE INDEX "system_jobs_single_executing_job_idx"
    ON "system_jobs" ((1))
    WHERE "status" IN ('RUNNING', 'PAUSING', 'CANCELLING');

COMMIT;
