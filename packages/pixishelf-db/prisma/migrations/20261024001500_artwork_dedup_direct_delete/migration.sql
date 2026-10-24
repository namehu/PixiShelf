-- Additive: legacy plans retain NULL protocol and cannot become delete authority.
ALTER TABLE "ArtworkDedupOperation"
 ADD COLUMN "protocolVersion" INTEGER,
 ADD COLUMN "scopeDigest" TEXT,
 ADD COLUMN "directDeleteConfirmedAt" TIMESTAMP(3),
 ADD COLUMN "freshVerifiedExecutionVersion" INTEGER,
 ADD COLUMN "deleteStartedAt" TIMESTAMP(3);
ALTER TABLE "ArtworkDedupOperation" DROP CONSTRAINT "ArtworkDedupOperation_contract";
ALTER TABLE "ArtworkDedupOperation" ADD CONSTRAINT "ArtworkDedupOperation_contract" CHECK (
  version > 0 AND "executionVersion" > 0 AND "runVersion" > 0 AND "frozenReviewRevision" >= 0
  AND mode IN ('PREPARE','ISOLATE','RESTORE','PURGE','DIRECT_DELETE') AND "originalAction" IN ('PREPARE','ISOLATE','RESTORE','PURGE','DIRECT_DELETE')
  AND "preparePurpose" IN ('ISOLATION','PURGE','DIRECT_DELETE')
  AND status IN ('BUILDING','READY','STALE','FAILED','ISOLATING','ISOLATED','RESTORING','RESTORED','PURGING','PURGED','RECOVERY_REQUIRED','CANCELLED','DRAINING','VERIFYING','DELETING','DELETED','STOPPED')
  AND (("readerState"='IDLE' AND "readerToken" IS NULL) OR ("readerState" IN ('STARTING','ACTIVE','BLOCKED') AND "readerToken" IS NOT NULL))
);
ALTER TABLE "ArtworkDedupOperation" ADD CONSTRAINT "ArtworkDedupOperation_direct_delete_contract" CHECK (
 ("preparePurpose" <> 'DIRECT_DELETE' AND "protocolVersion" IS NULL AND "scopeDigest" IS NULL AND "directDeleteConfirmedAt" IS NULL AND "freshVerifiedExecutionVersion" IS NULL AND "deleteStartedAt" IS NULL AND mode <> 'DIRECT_DELETE')
 OR ("preparePurpose"='DIRECT_DELETE' AND "protocolVersion"=1
   AND ("scopeDigest" IS NULL OR "scopeDigest" ~ '^[a-f0-9]{64}$')
   AND (mode <> 'DIRECT_DELETE' OR ("scopeDigest" IS NOT NULL AND "directDeleteConfirmedAt" IS NOT NULL AND "externalWritesStoppedAt" IS NOT NULL AND "authorizationDigest" IS NOT NULL))
   AND ("freshVerifiedExecutionVersion" IS NULL OR "freshVerifiedExecutionVersion">0)
   AND ("deleteStartedAt" IS NULL OR (mode='DIRECT_DELETE' AND "freshVerifiedExecutionVersion" IS NOT NULL)))
);
CREATE OR REPLACE FUNCTION sync_artwork_dedup_maintenance_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type='ARTWORK_DEDUP_MAINTENANCE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('FAILED','SKIPPED','CANCELLED') THEN
  UPDATE "ArtworkDedupOperation" SET
   status=CASE WHEN mode='PREPARE' AND "preparePurpose"='PURGE' THEN 'ISOLATED' WHEN mode='PREPARE' THEN CASE WHEN NEW.status='CANCELLED' THEN 'CANCELLED' ELSE 'FAILED' END ELSE 'RECOVERY_REQUIRED' END,
   "purgePreviewStatus"=CASE WHEN mode='PREPARE' AND "preparePurpose"='PURGE' THEN 'FAILED' ELSE "purgePreviewStatus" END,
   version=version+1,"errorCode"=coalesce("errorCode",'MAINTENANCE_FAILED'),"updatedAt"=CURRENT_TIMESTAMP
  WHERE "jobId"=NEW.id AND status NOT IN ('STALE','PURGED','RESTORED','DELETED','CANCELLED');
 END IF;
 RETURN NEW;
END;
$$;
