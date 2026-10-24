-- AlterTable
ALTER TABLE "ArtworkDedupCommand" ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "operationId" TEXT,
ADD COLUMN     "requestDigest" TEXT;

-- CreateTable
CREATE TABLE "ArtworkDedupReviewState" (
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "reviewRevision" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkDedupReviewState_pkey" PRIMARY KEY ("runId","userId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupReview" (
    "runId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "keeperArtworkId" INTEGER NOT NULL,
    "reviewVersion" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkDedupReview_pkey" PRIMARY KEY ("runId","userId","groupId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupOperation" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "artistId" INTEGER NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestDigest" TEXT NOT NULL,
    "runVersion" INTEGER NOT NULL,
    "frozenReviewRevision" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "executionVersion" INTEGER NOT NULL DEFAULT 1,
    "jobId" TEXT,
    "mode" TEXT NOT NULL DEFAULT 'PREPARE',
    "originalAction" TEXT NOT NULL DEFAULT 'PREPARE',
    "preparePurpose" TEXT NOT NULL DEFAULT 'ISOLATION',
    "status" TEXT NOT NULL DEFAULT 'BUILDING',
    "stage" TEXT NOT NULL DEFAULT 'INVENTORY',
    "selectionKind" TEXT NOT NULL,
    "rootBindings" JSONB,
    "readerToken" TEXT,
    "readerState" TEXT NOT NULL DEFAULT 'IDLE',
    "readerOwner" JSONB,
    "afterArtworkId" INTEGER NOT NULL DEFAULT 0,
    "afterImageId" INTEGER NOT NULL DEFAULT 0,
    "afterFileId" TEXT,
    "selectedGroups" INTEGER NOT NULL DEFAULT 0,
    "excludedGroups" INTEGER NOT NULL DEFAULT 0,
    "blockedGroups" INTEGER NOT NULL DEFAULT 0,
    "keepers" INTEGER NOT NULL DEFAULT 0,
    "copies" INTEGER NOT NULL DEFAULT 0,
    "preparedArtworks" INTEGER NOT NULL DEFAULT 0,
    "preparedFiles" BIGINT NOT NULL DEFAULT 0,
    "logicalBytes" BIGINT,
    "movedFiles" BIGINT NOT NULL DEFAULT 0,
    "restoredFiles" BIGINT NOT NULL DEFAULT 0,
    "deletedFiles" BIGINT NOT NULL DEFAULT 0,
    "requiresOrganizationConfirmation" BOOLEAN NOT NULL DEFAULT false,
    "backupCheckpointRef" TEXT,
    "backupConfirmedAt" TIMESTAMP(3),
    "externalWritesStoppedAt" TIMESTAMP(3),
    "organizationConfirmedAt" TIMESTAMP(3),
    "purgeConfirmedAt" TIMESTAMP(3),
    "authorizationVersion" INTEGER,
    "authorizationDigest" TEXT,
    "purgePreviewVersion" INTEGER,
    "purgePreviewStatus" TEXT,
    "purgePreviewValidatedAt" TIMESTAMP(3),
    "cancelRequestedAt" TIMESTAMP(3),
    "validatedAt" TIMESTAMP(3),
    "lastProgressAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkDedupOperation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtworkDedupOperationGroup" (
    "operationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "keeperArtworkId" INTEGER,
    "reviewVersion" INTEGER NOT NULL DEFAULT 0,
    "selectionBasis" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SELECTED',
    "reason" TEXT,

    CONSTRAINT "ArtworkDedupOperationGroup_pkey" PRIMARY KEY ("operationId","groupId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupOperationArtwork" (
    "operationId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "groupId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SELECTED',
    "title" TEXT NOT NULL,
    "sourceLabel" TEXT NOT NULL,
    "thumbnailUrl" TEXT,
    "artworkCreatedAt" TIMESTAMP(3) NOT NULL,
    "isUrl" BOOLEAN NOT NULL DEFAULT false,
    "frozenMediaRevision" INTEGER NOT NULL,
    "snapshotRevision" BIGINT NOT NULL,
    "mediaEpoch" BIGINT NOT NULL,
    "membersSignature" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    "memberCount" BIGINT NOT NULL,
    "organizationSignature" TEXT NOT NULL,
    "sourceSignature" TEXT NOT NULL,
    "creatorSignature" TEXT NOT NULL,
    "storagePath" TEXT,
    "storageKey" TEXT,
    "metaSource" TEXT,
    "externalId" TEXT,
    "afterImageId" INTEGER NOT NULL DEFAULT 0,
    "afterFileId" TEXT,
    "inventoryComplete" BOOLEAN NOT NULL DEFAULT false,
    "inspectionComplete" BOOLEAN NOT NULL DEFAULT false,
    "fileCount" BIGINT NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "manifestDigest" TEXT,
    "manifestPersistedAt" TIMESTAMP(3),
    "freshContentSha256" TEXT,
    "freshMembersSignature" TEXT,
    "freshVerifiedExecutionVersion" INTEGER,
    "freshVerifiedAt" TIMESTAMP(3),
    "selectedForAction" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkDedupOperationArtwork_pkey" PRIMARY KEY ("operationId","artworkId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupOperationFile" (
    "fileId" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "referenceKey" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "imageId" INTEGER,
    "revisionId" TEXT,
    "logicalRoot" TEXT NOT NULL,
    "rootIdentity" TEXT NOT NULL,
    "canonicalPath" TEXT NOT NULL,
    "relativeDirectory" TEXT,
    "directoryId" TEXT,
    "directoryGeneration" BIGINT,
    "isolationRelativePath" TEXT,
    "size" BIGINT,
    "mtimeNs" BIGINT,
    "ctimeNs" BIGINT,
    "deviceId" BIGINT,
    "inode" BIGINT,
    "linkCount" BIGINT,
    "fileType" TEXT,
    "sourceRevision" BIGINT,
    "sha256" TEXT,
    "ownershipStatus" TEXT NOT NULL DEFAULT 'UNCONFIRMED',
    "inspectionStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "requiresReview" BOOLEAN NOT NULL DEFAULT false,
    "blockReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkDedupOperationFile_pkey" PRIMARY KEY ("fileId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupClaim" (
    "artworkId" INTEGER NOT NULL,
    "operationId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "executionVersion" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtworkDedupClaim_pkey" PRIMARY KEY ("artworkId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupSourceIdentity" (
    "id" TEXT NOT NULL,
    "identityKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "logicalRoot" TEXT,
    "rootIdentity" TEXT,
    "canonicalPath" TEXT,
    "providerKey" TEXT,
    "externalId" TEXT,
    "displayName" TEXT NOT NULL,
    "generation" BIGINT NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "ownerOperationId" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkDedupSourceIdentity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtworkDedupOperationSource" (
    "operationId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "sourceId" TEXT NOT NULL,
    "frozenGeneration" BIGINT NOT NULL,

    CONSTRAINT "ArtworkDedupOperationSource_pkey" PRIMARY KEY ("operationId","artworkId","sourceId")
);

-- CreateTable
CREATE TABLE "ArtworkDedupFileReceipt" (
    "id" TEXT NOT NULL,
    "operationId" TEXT NOT NULL,
    "fileId" TEXT NOT NULL,
    "executionVersion" INTEGER NOT NULL,
    "step" TEXT NOT NULL,
    "expectedFileVersion" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INTENT',
    "receipt" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ArtworkDedupFileReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArtworkDedupReviewState_userId_idx" ON "ArtworkDedupReviewState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupOperation_jobId_key" ON "ArtworkDedupOperation"("jobId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupOperation_readerToken_key" ON "ArtworkDedupOperation"("readerToken");

-- CreateIndex
CREATE INDEX "ArtworkDedupOperation_artistId_createdAt_id_idx" ON "ArtworkDedupOperation"("artistId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "ArtworkDedupOperation_status_createdAt_idx" ON "ArtworkDedupOperation"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupOperation_requestedBy_idempotencyKey_key" ON "ArtworkDedupOperation"("requestedBy", "idempotencyKey");

-- CreateIndex
CREATE INDEX "ArtworkDedupOperationArtwork_operationId_status_artworkId_idx" ON "ArtworkDedupOperationArtwork"("operationId", "status", "artworkId");

-- CreateIndex
CREATE INDEX "ArtworkDedupOperationFile_operationId_artworkId_fileId_idx" ON "ArtworkDedupOperationFile"("operationId", "artworkId", "fileId");

-- CreateIndex
CREATE INDEX "ArtworkDedupOperationFile_operationId_status_fileId_idx" ON "ArtworkDedupOperationFile"("operationId", "status", "fileId");

-- CreateIndex
CREATE INDEX "ArtworkDedupOperationFile_rootIdentity_canonicalPath_idx" ON "ArtworkDedupOperationFile"("rootIdentity", "canonicalPath");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupOperationFile_operationId_referenceKey_key" ON "ArtworkDedupOperationFile"("operationId", "referenceKey");

-- CreateIndex
CREATE INDEX "ArtworkDedupClaim_operationId_role_artworkId_idx" ON "ArtworkDedupClaim"("operationId", "role", "artworkId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupSourceIdentity_identityKey_key" ON "ArtworkDedupSourceIdentity"("identityKey");

-- CreateIndex
CREATE INDEX "ArtworkDedupSourceIdentity_status_ownerOperationId_idx" ON "ArtworkDedupSourceIdentity"("status", "ownerOperationId");

-- CreateIndex
CREATE INDEX "ArtworkDedupSourceIdentity_providerKey_externalId_idx" ON "ArtworkDedupSourceIdentity"("providerKey", "externalId");

-- CreateIndex
CREATE INDEX "ArtworkDedupSourceIdentity_rootIdentity_canonicalPath_idx" ON "ArtworkDedupSourceIdentity"("rootIdentity", "canonicalPath");

-- CreateIndex
CREATE INDEX "ArtworkDedupOperationSource_sourceId_operationId_idx" ON "ArtworkDedupOperationSource"("sourceId", "operationId");

-- CreateIndex
CREATE UNIQUE INDEX "ArtworkDedupFileReceipt_operationId_fileId_executionVersion_key" ON "ArtworkDedupFileReceipt"("operationId", "fileId", "executionVersion", "step");

-- AddForeignKey
ALTER TABLE "ArtworkDedupReviewState" ADD CONSTRAINT "ArtworkDedupReviewState_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ArtworkDedupRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupReview" ADD CONSTRAINT "ArtworkDedupReview_runId_userId_fkey" FOREIGN KEY ("runId", "userId") REFERENCES "ArtworkDedupReviewState"("runId", "userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupOperation" ADD CONSTRAINT "ArtworkDedupOperation_runId_fkey" FOREIGN KEY ("runId") REFERENCES "ArtworkDedupRun"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupOperationGroup" ADD CONSTRAINT "ArtworkDedupOperationGroup_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ArtworkDedupOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupOperationArtwork" ADD CONSTRAINT "ArtworkDedupOperationArtwork_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ArtworkDedupOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupOperationFile" ADD CONSTRAINT "ArtworkDedupOperationFile_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ArtworkDedupOperation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupOperationFile" ADD CONSTRAINT "ArtworkDedupOperationFile_operationId_artworkId_fkey" FOREIGN KEY ("operationId", "artworkId") REFERENCES "ArtworkDedupOperationArtwork"("operationId", "artworkId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupClaim" ADD CONSTRAINT "ArtworkDedupClaim_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ArtworkDedupOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupOperationSource" ADD CONSTRAINT "ArtworkDedupOperationSource_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ArtworkDedupOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupOperationSource" ADD CONSTRAINT "ArtworkDedupOperationSource_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "ArtworkDedupSourceIdentity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupFileReceipt" ADD CONSTRAINT "ArtworkDedupFileReceipt_operationId_fkey" FOREIGN KEY ("operationId") REFERENCES "ArtworkDedupOperation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkDedupFileReceipt" ADD CONSTRAINT "ArtworkDedupFileReceipt_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "ArtworkDedupOperationFile"("fileId") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "ArtworkDedupOperation" ADD CONSTRAINT "ArtworkDedupOperation_contract" CHECK (
  version > 0 AND "executionVersion" > 0 AND "runVersion" > 0 AND "frozenReviewRevision" >= 0
  AND mode IN ('PREPARE','ISOLATE','RESTORE','PURGE') AND "originalAction" IN ('PREPARE','ISOLATE','RESTORE','PURGE')
  AND "preparePurpose" IN ('ISOLATION','PURGE')
  AND status IN ('BUILDING','READY','STALE','FAILED','ISOLATING','ISOLATED','RESTORING','RESTORED','PURGING','PURGED','RECOVERY_REQUIRED','CANCELLED')
  AND (("readerState"='IDLE' AND "readerToken" IS NULL) OR ("readerState" IN ('STARTING','ACTIVE','BLOCKED') AND "readerToken" IS NOT NULL))
);
ALTER TABLE "ArtworkDedupClaim" ADD CONSTRAINT "ArtworkDedupClaim_role" CHECK (role IN ('KEEPER','COPY') AND "executionVersion">0);
ALTER TABLE "ArtworkDedupSourceIdentity" ADD CONSTRAINT "ArtworkDedupSourceIdentity_state" CHECK (status IN ('OPEN','HOLD','TOMBSTONE') AND generation>=0 AND ((status='OPEN' AND "ownerOperationId" IS NULL) OR (status<>'OPEN' AND "ownerOperationId" IS NOT NULL)));
ALTER TABLE "ArtworkDedupOperationFile" ADD CONSTRAINT "ArtworkDedupOperationFile_contract" CHECK (
  version>0 AND (size IS NULL OR size>=0) AND (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$')
  AND role IN ('MEDIA','CHAPTER','SOURCE_FILE','ATTACHMENT','UNKNOWN')
  AND status IN ('PENDING','VERIFIED','MOVE_INTENT','MOVED','RESTORE_INTENT','RESTORED','DELETE_INTENT','DELETED','BLOCKED')
);
ALTER TABLE "system_jobs" DROP CONSTRAINT "system_jobs_dedup_policy";
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_dedup_policy" CHECK (
 type NOT IN ('ARTWORK_DEDUP_SCAN','ARTWORK_DEDUP_MAINTENANCE') OR (
 "definitionVersion"=1 AND "executionLane"='BACKGROUND_WRITER' AND "triggerSource"='SYSTEM'
 AND "queuePriority"=900 AND "effectivePriority"=900 AND "scheduledTaskId" IS NULL AND "parentJobId" IS NULL AND "deadlineAt" IS NULL));

CREATE FUNCTION sync_artwork_dedup_maintenance_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.type='ARTWORK_DEDUP_MAINTENANCE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('FAILED','SKIPPED','CANCELLED') THEN
  UPDATE "ArtworkDedupOperation" SET
   status=CASE WHEN mode='PREPARE' AND "preparePurpose"='PURGE' THEN 'ISOLATED' WHEN mode='PREPARE' THEN CASE WHEN NEW.status='CANCELLED' THEN 'CANCELLED' ELSE 'FAILED' END ELSE 'RECOVERY_REQUIRED' END,
   "purgePreviewStatus"=CASE WHEN mode='PREPARE' AND "preparePurpose"='PURGE' THEN 'FAILED' ELSE "purgePreviewStatus" END,
   version=version+1,"errorCode"=coalesce("errorCode",'MAINTENANCE_FAILED'),"updatedAt"=CURRENT_TIMESTAMP
  WHERE "jobId"=NEW.id AND status NOT IN ('STALE','PURGED','RESTORED');
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER "system_jobs_dedup_maintenance_state" AFTER UPDATE OF status ON "system_jobs" FOR EACH ROW EXECUTE FUNCTION sync_artwork_dedup_maintenance_state();

-- Private organization evidence deliberately excludes reading/progress activity.
CREATE FUNCTION artwork_dedup_organization_signature(artwork_id integer) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(coalesce(string_agg(v,',' ORDER BY kind,key),'[]'),'UTF8')),'hex')
 FROM (
 SELECT 'rating' kind,id::text key,json_build_array(id,"userId",level,"createdAt","updatedAt")::text v FROM "ArtworkLike" WHERE "artworkId"=artwork_id
 UNION ALL
 SELECT 'mark',id,json_build_array(id,"userId","mediaId","bookmarkedAt","likedAt","artworkTitle","mediaPosition","mediaType")::text FROM "MediaMark"
 WHERE "artworkId"=artwork_id AND ("bookmarkedAt" IS NOT NULL OR "likedAt" IS NOT NULL)
 ) facts;
$$;
CREATE FUNCTION artwork_dedup_creator_signature(artwork_id integer) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(coalesce(string_agg(json_build_array(m.id,m."artistId",ar."mergedIntoId",e.id,e."evidenceKey",e.present,e."excludedAt")::text,',' ORDER BY m.id,e.id),'[]'),'UTF8')),'hex')
 FROM artwork_artists m JOIN "Artist" ar ON ar.id=m."artistId" JOIN artwork_artist_evidence e ON e."membershipId"=m.id WHERE m."artworkId"=artwork_id;
$$;
CREATE FUNCTION artwork_dedup_source_signature(artwork_id integer) RETURNS text LANGUAGE sql STABLE AS $$
 SELECT encode(sha256(convert_to(coalesce(string_agg(v,',' ORDER BY kind,key),'[]'),'UTF8')),'hex') FROM (
 SELECT 'artwork' kind,id::text key,json_build_array("storagePath","storageKey","metaSource","externalId",source,"createdVia")::text v FROM "Artwork" WHERE id=artwork_id
 UNION ALL SELECT 'source',id,json_build_array(id,"providerKey","externalId","canonicalUrl",locator,"onlineSnapshotPath","onlineSnapshotHash")::text FROM artwork_external_refs WHERE "artworkId"=artwork_id
 UNION ALL SELECT 'revision',id,json_build_array(id,"externalRefId","archivePath","manifestPath","metadataHash","isCurrent","trashPath")::text FROM archive_revisions WHERE "artworkId"=artwork_id
 UNION ALL SELECT 'chapter',id::text,json_build_array(id,"chaptersPath","chaptersHash","chaptersUpdatedAt")::text FROM "Image" WHERE "artworkId"=artwork_id AND "chaptersPath" IS NOT NULL
 ) facts;
$$;
