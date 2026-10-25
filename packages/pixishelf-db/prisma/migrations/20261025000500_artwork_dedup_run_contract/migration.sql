-- Restore the detection invariant removed during the containment-stage extension.
-- Preserve the original contract; MATCH is its only additional stage.
ALTER TABLE "ArtworkDedupRun" ADD CONSTRAINT "ArtworkDedupRun_contract" CHECK (
  mode IN ('INCREMENTAL','FULL') AND version > 0 AND "executionVersion" > 0 AND "algorithmVersion" = 1
  AND status IN ('PENDING','RUNNING','PAUSING','PAUSED','RETRY_WAIT','CANCELLING','COMPLETED','FAILED','CANCELLED')
  AND stage IN ('STAT','CANDIDATES','HASH','GROUP','MATCH','DONE')
  AND (("readerState" = 'IDLE' AND "readerToken" IS NULL) OR ("readerState" IN ('STARTING','ACTIVE','BLOCKED') AND "readerToken" IS NOT NULL))
);
ALTER TABLE "ArtworkDedupRun" ADD CONSTRAINT "ArtworkDedupRun_relation_cursor_check" CHECK (
  "relationAfterArtworkId" >= 0 AND "relationAfterCandidateId" >= 0
);
