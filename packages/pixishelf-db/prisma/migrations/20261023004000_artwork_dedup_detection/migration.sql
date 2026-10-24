-- CreateTable
CREATE TABLE "ArtworkDedupRun" (
    "lastProgressAt" TIMESTAMP(3),
    "retryReadBytes" BIGINT NOT NULL DEFAULT 0,
    "readerOwner" JSONB,
    "readerToken" TEXT,
    "readerState" TEXT NOT NULL DEFAULT 'IDLE',
    "id" TEXT NOT NULL,
    "artistId" INTEGER NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "algorithmVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "executionVersion" INTEGER NOT NULL DEFAULT 1,
    "jobId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "stage" TEXT NOT NULL DEFAULT 'STAT',
    "frozenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "artworkCount" INTEGER NOT NULL DEFAULT 0,
    "processedArtworks" INTEGER NOT NULL DEFAULT 0,
    "completeArtworks" INTEGER NOT NULL DEFAULT 0,
    "changedArtworks" INTEGER NOT NULL DEFAULT 0,
    "failedArtworks" INTEGER NOT NULL DEFAULT 0,
    "skippedArtworks" INTEGER NOT NULL DEFAULT 0,
    "groupCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateArtworks" INTEGER NOT NULL DEFAULT 0,
    "statMedia" INTEGER NOT NULL DEFAULT 0,
    "hashedMedia" INTEGER NOT NULL DEFAULT 0,
    "cacheHitMedia" INTEGER NOT NULL DEFAULT 0,
    "readBytes" BIGINT NOT NULL DEFAULT 0,
    "errorCode" TEXT,

    CONSTRAINT "ArtworkDedupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtworkDedupItem" (
    "runId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "frozenMediaRevision" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "snapshotRevision" BIGINT,
    "mediaEpoch" BIGINT,
    "memberCount" BIGINT,
    "afterImageId" INTEGER NOT NULL DEFAULT 0,
    "sizeDigest" TEXT,
    "contentSha256" TEXT,
    "membersSignature" TEXT,
    "errorCode" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkDedupItem_pkey" PRIMARY KEY ("runId","artworkId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupMedia" (
    "runId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "imageId" INTEGER NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "sourceRevision" BIGINT NOT NULL,
    "logicalRoot" TEXT NOT NULL,
    "rootIdentity" TEXT NOT NULL,
    "relativeDirectory" TEXT NOT NULL,
    "directoryId" TEXT NOT NULL,
    "directoryGeneration" BIGINT NOT NULL,
    "canonicalPath" TEXT NOT NULL,
    "size" BIGINT NOT NULL,
    "mtimeNs" BIGINT,
    "ctimeNs" BIGINT,
    "deviceId" BIGINT,
    "inode" BIGINT,
    "sha256" TEXT,

    CONSTRAINT "ArtworkDedupMedia_pkey" PRIMARY KEY ("runId","artworkId","imageId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupGroup" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "memberCount" INTEGER NOT NULL,
    "fileCount" BIGINT NOT NULL,

    CONSTRAINT "ArtworkDedupGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtworkDedupGroupMember" (
    "runId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,

    CONSTRAINT "ArtworkDedupGroupMember_pkey" PRIMARY KEY ("runId","artworkId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupCommand" (
    "runId" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "expectedVersion" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "resultingVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtworkDedupCommand_pkey" PRIMARY KEY ("requestedBy","idempotencyKey")
);

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupRun_readerToken_key" ON "ArtworkDedupRun"("readerToken");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupRun_jobId_key" ON "ArtworkDedupRun"("jobId");

-- CreateIndex
CREATE INDEX "ArtworkDedupRun_artistId_frozenAt_idx" ON "ArtworkDedupRun"("artistId", "frozenAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupRun_requestedBy_idempotencyKey_key" ON "ArtworkDedupRun"("requestedBy", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ArtworkDedupItem_runId_status_artworkId_idx" ON "ArtworkDedupItem"("runId", "status", "artworkId");

-- CreateIndex
CREATE INDEX "ArtworkDedupItem_runId_memberCount_sizeDigest_idx" ON "ArtworkDedupItem"("runId", "memberCount", "sizeDigest");

-- CreateIndex
CREATE INDEX "ArtworkDedupItem_runId_contentSha256_idx" ON "ArtworkDedupItem"("runId", "contentSha256");

-- CreateIndex
CREATE INDEX "ArtworkDedupMedia_runId_artworkId_size_imageId_idx" ON "ArtworkDedupMedia"("runId", "artworkId", "size", "imageId");

-- CreateIndex
CREATE INDEX "ArtworkDedupMedia_runId_artworkId_size_sha256_imageId_idx" ON "ArtworkDedupMedia"("runId", "artworkId", "size", "sha256", "imageId");

-- CreateIndex
CREATE INDEX "ArtworkDedupGroup_runId_id_idx" ON "ArtworkDedupGroup"("runId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupGroup_runId_id_key" ON "ArtworkDedupGroup"("runId", "id");

-- CreateIndex
CREATE INDEX "ArtworkDedupGroupMember_groupId_artworkId_idx" ON "ArtworkDedupGroupMember"("groupId", "artworkId");

-- CreateIndex
CREATE INDEX "ArtworkDedupCommand_runId_createdAt_idx" ON "ArtworkDedupCommand"("runId", "createdAt");

-- AddForeignKey
ALTER TABLE "ArtworkDedupRun" ADD CONSTRAINT "ArtworkDedupRun_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "system_jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupItem" ADD CONSTRAINT "ArtworkDedupItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ArtworkDedupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupMedia" ADD CONSTRAINT "ArtworkDedupMedia_runId_artworkId_fkey" FOREIGN KEY ("runId", "artworkId") REFERENCES "ArtworkDedupItem"("runId", "artworkId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupGroup" ADD CONSTRAINT "ArtworkDedupGroup_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ArtworkDedupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupGroupMember" ADD CONSTRAINT "ArtworkDedupGroupMember_runId_groupId_fkey" FOREIGN KEY ("runId", "groupId") REFERENCES "ArtworkDedupGroup"("runId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupGroupMember" ADD CONSTRAINT "ArtworkDedupGroupMember_runId_artworkId_fkey" FOREIGN KEY ("runId", "artworkId") REFERENCES "ArtworkDedupItem"("runId", "artworkId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupCommand" ADD CONSTRAINT "ArtworkDedupCommand_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ArtworkDedupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "ArtworkDedupRun_one_active_artist" ON "ArtworkDedupRun" ("artistId")
WHERE status IN ('PENDING','RUNNING','PAUSING','PAUSED','RETRY_WAIT','CANCELLING');
ALTER TABLE "ArtworkDedupRun" ADD CONSTRAINT "ArtworkDedupRun_contract" CHECK (
  mode IN ('INCREMENTAL','FULL') AND version > 0 AND "executionVersion" > 0 AND "algorithmVersion" = 1
  AND status IN ('PENDING','RUNNING','PAUSING','PAUSED','RETRY_WAIT','CANCELLING','COMPLETED','FAILED','CANCELLED')
  AND stage IN ('STAT','CANDIDATES','HASH','GROUP','DONE')
  AND (("readerState" = 'IDLE' AND "readerToken" IS NULL) OR ("readerState" IN ('STARTING','ACTIVE','BLOCKED') AND "readerToken" IS NOT NULL))
);
ALTER TABLE "ArtworkDedupItem" ADD CONSTRAINT "ArtworkDedupItem_status_check" CHECK (
  status IN ('PENDING','STATTING','SIZED','HASHING','COMPLETE','UNIQUE','CHANGED','FAILED','SKIPPED')
);
ALTER TABLE "ArtworkDedupMedia" ADD CONSTRAINT "ArtworkDedupMedia_size_check" CHECK (size > 0 AND (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'));
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_dedup_policy" CHECK (
  type <> 'ARTWORK_DEDUP_SCAN' OR (
    "definitionVersion" = 1 AND "executionLane" = 'BACKGROUND_WRITER' AND "triggerSource" = 'SYSTEM'
    AND "queuePriority" = 900 AND "effectivePriority" = 900 AND "scheduledTaskId" IS NULL
    AND "parentJobId" IS NULL AND "deadlineAt" IS NULL
  )
);

-- Queue recovery and every finalizer update the domain lifecycle atomically.
CREATE FUNCTION sync_artwork_dedup_job_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.type = 'ARTWORK_DEDUP_SCAN' AND NEW.status IS DISTINCT FROM OLD.status THEN
    UPDATE "ArtworkDedupRun" SET status = CASE WHEN NEW.status = 'SKIPPED' THEN 'FAILED' ELSE NEW.status::text END,
      version = version + 1, "updatedAt" = NEW."updatedAt",
      "startedAt" = COALESCE("startedAt", NEW."startedAt"),
      "finishedAt" = NEW."finishedAt",
      "errorCode" = CASE WHEN NEW.status IN ('FAILED','SKIPPED') THEN 'DETECTION_FAILED' ELSE NULL END
    WHERE "jobId" = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "system_jobs_dedup_state" AFTER UPDATE OF status ON "system_jobs"
FOR EACH ROW EXECUTE FUNCTION sync_artwork_dedup_job_state();
