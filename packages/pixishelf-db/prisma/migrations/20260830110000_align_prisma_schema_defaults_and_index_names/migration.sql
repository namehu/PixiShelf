-- These columns are managed by Prisma's @updatedAt behavior. The original
-- hand-written migrations added database defaults that are not part of the
-- Prisma schema, which made `prisma migrate dev` report a persistent diff.
ALTER TABLE "archive_resolve_queue_control"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "artist_external_refs"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "series_external_refs"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

-- PostgreSQL silently truncated the original names to 63 bytes. Rename the
-- physical indexes to the deterministic shortened names expected by Prisma.
ALTER INDEX "archive_bulk_operation_items_operationId_targetType_targetId_ke"
  RENAME TO "archive_bulk_operation_items_operationId_targetType_targetI_key";

ALTER INDEX "archive_provider_request_leases_providerKey_requestClass_expire"
  RENAME TO "archive_provider_request_leases_providerKey_requestClass_ex_idx";

ALTER INDEX "artwork_external_refs_providerKey_seriesSyncStatus_seriesLastAt"
  RENAME TO "artwork_external_refs_providerKey_seriesSyncStatus_seriesLa_idx";
