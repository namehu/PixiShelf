-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ArchiveBulkOperationCommand" ADD VALUE 'BIND_CREATORS';
ALTER TYPE "ArchiveBulkOperationCommand" ADD VALUE 'CANCEL_PENDING_CREATORS';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ArchiveBulkOperationTarget" ADD VALUE 'DISCOVERY_ITEM';
ALTER TYPE "ArchiveBulkOperationTarget" ADD VALUE 'PENDING_CREATOR_BINDING';

-- AlterTable
ALTER TABLE "archive_uploader_scan_runs" ADD COLUMN     "defaultCreatorIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[];

-- AlterTable
ALTER TABLE "archive_uploader_catalog_items" ADD COLUMN     "firstMatchedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "discovery_source_creators" (
    "sourceId" TEXT NOT NULL,
    "artistId" INTEGER NOT NULL,

    CONSTRAINT "discovery_source_creators_pkey" PRIMARY KEY ("sourceId","artistId")
);

-- CreateTable
CREATE TABLE "discovery_pending_creators" (
    "id" TEXT NOT NULL,
    "providerKey" VARCHAR(50) NOT NULL,
    "externalId" VARCHAR(120) NOT NULL,
    "artistId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "requestedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_pending_creators_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discovery_creator_suppressions" (
    "providerKey" VARCHAR(50) NOT NULL,
    "externalId" VARCHAR(120) NOT NULL,
    "artistId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discovery_creator_suppressions_pkey" PRIMARY KEY ("providerKey","externalId","artistId")
);

-- CreateIndex
CREATE INDEX "discovery_source_creators_artistId_idx" ON "discovery_source_creators"("artistId");

-- CreateIndex
CREATE INDEX "discovery_pending_creators_artistId_idx" ON "discovery_pending_creators"("artistId");

-- CreateIndex
CREATE INDEX "discovery_pending_creators_createdAt_id_idx" ON "discovery_pending_creators"("createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "discovery_pending_creators_providerKey_externalId_artistId_key" ON "discovery_pending_creators"("providerKey", "externalId", "artistId");

-- CreateIndex
CREATE INDEX "discovery_creator_suppressions_artistId_idx" ON "discovery_creator_suppressions"("artistId");

-- AddForeignKey
ALTER TABLE "discovery_source_creators" ADD CONSTRAINT "discovery_source_creators_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "archive_uploader_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_source_creators" ADD CONSTRAINT "discovery_source_creators_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_pending_creators" ADD CONSTRAINT "discovery_pending_creators_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discovery_creator_suppressions" ADD CONSTRAINT "discovery_creator_suppressions_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
UPDATE archive_uploader_catalog_items SET "firstMatchedAt" = "lastSeenAt" WHERE "matchesQuery" = true;
INSERT INTO discovery_creator_suppressions ("providerKey", "externalId", "artistId", "createdAt")
SELECT DISTINCT r."providerKey", r."externalId", m."artistId", CURRENT_TIMESTAMP
FROM artwork_artists m JOIN artwork_external_refs r ON r."artworkId" = m."artworkId"
WHERE EXISTS (SELECT 1 FROM artwork_artist_evidence e WHERE e."membershipId" = m.id AND e."excludedAt" IS NOT NULL)
AND NOT EXISTS (SELECT 1 FROM artwork_artist_evidence e WHERE e."membershipId" = m.id AND e.present = true AND e."excludedAt" IS NULL)
ON CONFLICT DO NOTHING;
