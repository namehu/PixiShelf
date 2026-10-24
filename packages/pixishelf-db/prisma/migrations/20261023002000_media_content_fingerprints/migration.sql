-- CreateEnum
CREATE TYPE "MediaContentWriteScopeKind" AS ENUM ('PATH', 'DIRECTORY');

-- CreateEnum
CREATE TYPE "MediaContentWriteStatus" AS ENUM ('ACTIVE', 'READY', 'RECOVERY_REQUIRED', 'COMPLETED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "MediaContentChildDisposition" AS ENUM ('PUBLISH', 'RESTORED', 'REMOVED', 'ISOLATED');

-- CreateTable
CREATE TABLE "MediaContentDirectoryState" (
    "id" TEXT NOT NULL,
    "logicalRoot" TEXT NOT NULL,
    "relativeDirectory" TEXT NOT NULL,
    "rootIdentity" TEXT NOT NULL,
    "generation" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaContentDirectoryState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaContentPathWrite" (
    "id" TEXT NOT NULL,
    "directoryId" TEXT NOT NULL,
    "scope" "MediaContentWriteScopeKind" NOT NULL,
    "relativePath" TEXT,
    "parentWriteId" TEXT,
    "sessionId" TEXT NOT NULL,
    "ownerUserId" TEXT,
    "sessionVersion" BIGINT NOT NULL,
    "writeToken" TEXT NOT NULL,
    "declarationVersion" BIGINT NOT NULL DEFAULT 1,
    "jobId" TEXT,
    "executionToken" TEXT,
    "executionAttempt" INTEGER,
    "status" "MediaContentWriteStatus" NOT NULL DEFAULT 'ACTIVE',
    "declaredFileSize" BIGINT,
    "totalChunks" INTEGER,
    "nextChunkIndex" INTEGER NOT NULL DEFAULT 0,
    "committedBytes" BIGINT NOT NULL DEFAULT 0,
    "lastRequestId" TEXT,
    "lastChunkIndex" INTEGER,
    "lastChunkOffset" BIGINT,
    "lastChunkBytes" BIGINT,
    "lastChunkSha256" TEXT,
    "childDisposition" "MediaContentChildDisposition",
    "resolutionEvidenceId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaContentPathWrite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaContentSource" (
    "imageId" INTEGER NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "directoryStateId" TEXT,
    "writeToken" TEXT,
    "writeStartedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaContentSource_pkey" PRIMARY KEY ("imageId")
);

-- CreateTable
CREATE TABLE "ArtworkContentSource" (
    "artworkId" INTEGER NOT NULL,
    "revision" BIGINT NOT NULL DEFAULT 0,
    "mediaEpoch" BIGINT NOT NULL DEFAULT 0,
    "writeToken" TEXT,
    "writeStartedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkContentSource_pkey" PRIMARY KEY ("artworkId")
);

-- CreateTable
CREATE TABLE "MediaContentFingerprint" (
    "imageId" INTEGER NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    "rootIdentity" TEXT NOT NULL,
    "sourcePath" TEXT NOT NULL,
    "canonicalPath" TEXT NOT NULL,
    "sourceRevision" BIGINT NOT NULL,
    "artworkMediaEpoch" BIGINT NOT NULL,
    "size" BIGINT NOT NULL,
    "mtimeNs" BIGINT,
    "ctimeNs" BIGINT,
    "deviceId" BIGINT,
    "inode" BIGINT,
    "sha256" VARCHAR(64) NOT NULL,
    "hashedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaContentFingerprint_pkey" PRIMARY KEY ("imageId")
);

-- CreateTable
CREATE TABLE "ArtworkContentFingerprint" (
    "artworkId" INTEGER NOT NULL,
    "algorithmVersion" INTEGER NOT NULL,
    "sourceRevision" BIGINT NOT NULL,
    "mediaEpoch" BIGINT NOT NULL,
    "membersSignature" VARCHAR(64) NOT NULL,
    "fileCount" BIGINT NOT NULL,
    "contentSha256" VARCHAR(64) NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkContentFingerprint_pkey" PRIMARY KEY ("artworkId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaContentDirectoryState_logicalRoot_relativeDirectory_key" ON "MediaContentDirectoryState"("logicalRoot", "relativeDirectory");

-- CreateIndex
CREATE UNIQUE INDEX "MediaContentPathWrite_writeToken_key" ON "MediaContentPathWrite"("writeToken");

-- CreateIndex
CREATE INDEX "MediaContentPathWrite_directoryId_status_idx" ON "MediaContentPathWrite"("directoryId", "status");

-- CreateIndex
CREATE INDEX "MediaContentPathWrite_parentWriteId_status_idx" ON "MediaContentPathWrite"("parentWriteId", "status");

-- CreateIndex
CREATE INDEX "MediaContentPathWrite_sessionId_ownerUserId_idx" ON "MediaContentPathWrite"("sessionId", "ownerUserId");

-- CreateIndex
CREATE INDEX "MediaContentSource_directoryStateId_imageId_idx" ON "MediaContentSource"("directoryStateId", "imageId");

-- CreateIndex
CREATE INDEX "MediaContentFingerprint_size_sha256_imageId_idx" ON "MediaContentFingerprint"("size", "sha256", "imageId");

-- CreateIndex
CREATE INDEX "ArtworkContentFingerprint_algorithmVersion_contentSha256_idx" ON "ArtworkContentFingerprint"("algorithmVersion", "contentSha256");

-- AddForeignKey
ALTER TABLE "MediaContentPathWrite" ADD CONSTRAINT "MediaContentPathWrite_directoryId_fkey" FOREIGN KEY ("directoryId") REFERENCES "MediaContentDirectoryState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaContentPathWrite" ADD CONSTRAINT "MediaContentPathWrite_parentWriteId_fkey" FOREIGN KEY ("parentWriteId") REFERENCES "MediaContentPathWrite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaContentSource" ADD CONSTRAINT "MediaContentSource_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaContentSource" ADD CONSTRAINT "MediaContentSource_directoryStateId_fkey" FOREIGN KEY ("directoryStateId") REFERENCES "MediaContentDirectoryState"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkContentSource" ADD CONSTRAINT "ArtworkContentSource_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaContentFingerprint" ADD CONSTRAINT "MediaContentFingerprint_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtworkContentFingerprint" ADD CONSTRAINT "ArtworkContentFingerprint_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- These states are intentionally empty after upgrade. No media access or hash backfill occurs.
ALTER TABLE "MediaContentDirectoryState" ADD CONSTRAINT media_content_directory_values_check CHECK (
  "logicalRoot" IN ('source-media:v1', 'archive-media:v1') AND generation >= 0 AND length("rootIdentity") > 0
  AND ("relativeDirectory" = '' OR ("relativeDirectory" !~ '(^/|/$|//|\\|(^|/)\.{1,2}(/|$)|^[A-Za-z]:)'))
);
ALTER TABLE "MediaContentPathWrite" ADD CONSTRAINT media_content_write_values_check CHECK (
  "sessionVersion" > 0 AND "declarationVersion" > 0 AND length("sessionId") > 0 AND length("writeToken") > 0
  AND ((scope = 'DIRECTORY' AND "relativePath" IS NULL AND "parentWriteId" IS NULL)
    OR (scope = 'PATH' AND "relativePath" IS NOT NULL AND length("relativePath") > 0 AND "relativePath" !~ '(^/|/$|//|\\|(^|/)\.{1,2}(/|$)|^[A-Za-z]:)'))
  AND (("jobId" IS NULL AND "executionToken" IS NULL AND "executionAttempt" IS NULL)
    OR ("jobId" IS NOT NULL AND "executionToken" IS NOT NULL AND "executionAttempt" > 0))
  AND "nextChunkIndex" >= 0 AND "committedBytes" >= 0
  AND (("declaredFileSize" IS NULL AND "totalChunks" IS NULL)
    OR (scope = 'PATH' AND "declaredFileSize" > 0 AND "totalChunks" > 0 AND "ownerUserId" IS NOT NULL AND "committedBytes" <= "declaredFileSize" AND "nextChunkIndex" <= "totalChunks"))
  AND (("lastRequestId" IS NULL AND "lastChunkIndex" IS NULL AND "lastChunkOffset" IS NULL AND "lastChunkBytes" IS NULL AND "lastChunkSha256" IS NULL)
    OR ("lastRequestId" IS NOT NULL AND "lastChunkIndex" >= 0 AND "lastChunkOffset" >= 0 AND "lastChunkBytes" > 0 AND "lastChunkSha256" ~ '^[a-f0-9]{64}$'))
  AND (status <> 'READY' OR ("declaredFileSize" IS NOT NULL AND "committedBytes" = "declaredFileSize" AND "nextChunkIndex" = "totalChunks" AND "lastRequestId" IS NOT NULL))
);
ALTER TABLE "MediaContentSource" ADD CONSTRAINT media_content_source_values_check CHECK (revision >= 0 AND (("writeToken" IS NULL) = ("writeStartedAt" IS NULL)));
ALTER TABLE "ArtworkContentSource" ADD CONSTRAINT artwork_content_source_values_check CHECK (revision >= 0 AND "mediaEpoch" >= 0 AND (("writeToken" IS NULL) = ("writeStartedAt" IS NULL)));
ALTER TABLE "MediaContentFingerprint" ADD CONSTRAINT media_content_fingerprint_values_check CHECK ("algorithmVersion" > 0 AND "sourceRevision" >= 0 AND "artworkMediaEpoch" >= 0 AND size > 0 AND sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE "ArtworkContentFingerprint" ADD CONSTRAINT artwork_content_fingerprint_values_check CHECK ("algorithmVersion" > 0 AND "sourceRevision" >= 0 AND "mediaEpoch" >= 0 AND "fileCount" > 0 AND "membersSignature" ~ '^[a-f0-9]{64}$' AND "contentSha256" ~ '^[a-f0-9]{64}$');
CREATE UNIQUE INDEX media_content_active_path_write_idx ON "MediaContentPathWrite" ("directoryId", "relativePath") WHERE scope = 'PATH' AND status IN ('ACTIVE','READY','RECOVERY_REQUIRED');
CREATE UNIQUE INDEX media_content_active_directory_write_idx ON "MediaContentPathWrite" ("directoryId") WHERE scope = 'DIRECTORY' AND status IN ('ACTIVE','READY','RECOVERY_REQUIRED');

CREATE FUNCTION media_content_images_inserted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM a.id FROM "Artwork" a WHERE a.id IN (SELECT "artworkId" FROM new_images WHERE "artworkId" IS NOT NULL) ORDER BY a.id FOR UPDATE;
  INSERT INTO "ArtworkContentSource" ("artworkId", revision, "mediaEpoch", "updatedAt")
    SELECT a.id, 1, 0, CURRENT_TIMESTAMP FROM "Artwork" a WHERE a.id IN (SELECT "artworkId" FROM new_images) ORDER BY a.id
    ON CONFLICT ("artworkId") DO UPDATE SET revision = "ArtworkContentSource".revision + 1, "updatedAt" = CURRENT_TIMESTAMP;
  DELETE FROM "ArtworkContentFingerprint" WHERE "artworkId" IN (SELECT "artworkId" FROM new_images);
  RETURN NULL;
END $$;
CREATE FUNCTION media_content_images_deleted() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM a.id FROM "Artwork" a WHERE a.id IN (SELECT "artworkId" FROM old_images WHERE "artworkId" IS NOT NULL) ORDER BY a.id FOR UPDATE;
  INSERT INTO "ArtworkContentSource" ("artworkId", revision, "mediaEpoch", "updatedAt")
    SELECT a.id, 1, 0, CURRENT_TIMESTAMP FROM "Artwork" a WHERE a.id IN (SELECT "artworkId" FROM old_images) ORDER BY a.id
    ON CONFLICT ("artworkId") DO UPDATE SET revision = "ArtworkContentSource".revision + 1, "updatedAt" = CURRENT_TIMESTAMP;
  DELETE FROM "ArtworkContentFingerprint" WHERE "artworkId" IN (SELECT "artworkId" FROM old_images);
  RETURN NULL;
END $$;
CREATE FUNCTION media_content_images_updated() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM a.id FROM "Artwork" a WHERE a.id IN (
    SELECT o."artworkId" FROM old_images o JOIN new_images n USING(id) WHERE ROW(o."artworkId",o.path,o.size) IS DISTINCT FROM ROW(n."artworkId",n.path,n.size)
    UNION SELECT n."artworkId" FROM old_images o JOIN new_images n USING(id) WHERE ROW(o."artworkId",o.path,o.size) IS DISTINCT FROM ROW(n."artworkId",n.path,n.size)
  ) ORDER BY a.id FOR UPDATE;
  INSERT INTO "ArtworkContentSource" ("artworkId", revision, "mediaEpoch", "updatedAt")
    SELECT a.id, 1, 0, CURRENT_TIMESTAMP FROM "Artwork" a WHERE a.id IN (
      SELECT o."artworkId" FROM old_images o JOIN new_images n USING(id) WHERE ROW(o."artworkId",o.path,o.size) IS DISTINCT FROM ROW(n."artworkId",n.path,n.size)
      UNION SELECT n."artworkId" FROM old_images o JOIN new_images n USING(id) WHERE ROW(o."artworkId",o.path,o.size) IS DISTINCT FROM ROW(n."artworkId",n.path,n.size)
    ) ORDER BY a.id ON CONFLICT ("artworkId") DO UPDATE SET revision = "ArtworkContentSource".revision + 1, "updatedAt" = CURRENT_TIMESTAMP;
  INSERT INTO "MediaContentSource" ("imageId", revision, "directoryStateId", "updatedAt")
    SELECT n.id, 1, CASE WHEN ROW(o."artworkId",o.path) IS NOT DISTINCT FROM ROW(n."artworkId",n.path) THEN s."directoryStateId" ELSE NULL END, CURRENT_TIMESTAMP
    FROM old_images o JOIN new_images n USING(id) LEFT JOIN "MediaContentSource" s ON s."imageId" = n.id
    WHERE ROW(o."artworkId",o.path,o.size) IS DISTINCT FROM ROW(n."artworkId",n.path,n.size) ORDER BY n.id
    ON CONFLICT ("imageId") DO UPDATE SET revision = "MediaContentSource".revision + 1, "directoryStateId" = EXCLUDED."directoryStateId", "updatedAt" = CURRENT_TIMESTAMP;
  DELETE FROM "MediaContentFingerprint" WHERE "imageId" IN (SELECT n.id FROM old_images o JOIN new_images n USING(id) WHERE ROW(o."artworkId",o.path,o.size) IS DISTINCT FROM ROW(n."artworkId",n.path,n.size));
  DELETE FROM "ArtworkContentFingerprint" WHERE "artworkId" IN (
    SELECT o."artworkId" FROM old_images o JOIN new_images n USING(id) WHERE ROW(o."artworkId",o.path,o.size) IS DISTINCT FROM ROW(n."artworkId",n.path,n.size)
    UNION SELECT n."artworkId" FROM old_images o JOIN new_images n USING(id) WHERE ROW(o."artworkId",o.path,o.size) IS DISTINCT FROM ROW(n."artworkId",n.path,n.size)
  );
  RETURN NULL;
END $$;
CREATE TRIGGER image_content_inserted AFTER INSERT ON "Image" REFERENCING NEW TABLE AS new_images FOR EACH STATEMENT EXECUTE FUNCTION media_content_images_inserted();
CREATE TRIGGER image_content_deleted AFTER DELETE ON "Image" REFERENCING OLD TABLE AS old_images FOR EACH STATEMENT EXECUTE FUNCTION media_content_images_deleted();
CREATE TRIGGER image_content_updated AFTER UPDATE ON "Image" REFERENCING OLD TABLE AS old_images NEW TABLE AS new_images FOR EACH STATEMENT EXECUTE FUNCTION media_content_images_updated();

