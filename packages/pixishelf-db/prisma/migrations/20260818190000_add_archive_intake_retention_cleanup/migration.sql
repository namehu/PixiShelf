BEGIN;

-- Retention discovers completed bulk-operation audits by completion time. The
-- executor still repeats this cutoff predicate inside its fenced delete.
CREATE INDEX "archive_bulk_operations_completedAt_idx"
  ON "archive_bulk_operations" ("completedAt");

COMMIT;
