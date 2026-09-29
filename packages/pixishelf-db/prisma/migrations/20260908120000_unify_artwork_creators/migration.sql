-- CreateEnum
CREATE TYPE "CreatorKind" AS ENUM ('PERSON', 'GROUP');

-- CreateEnum
CREATE TYPE "CreatorEvidenceKind" AS ENUM ('SOURCE', 'MANUAL', 'LEGACY');

-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "kind" "CreatorKind" NOT NULL DEFAULT 'PERSON';

-- CreateTable
CREATE TABLE "artist_source_tag_mappings" (
    "id" TEXT NOT NULL,
    "providerKey" VARCHAR(50) NOT NULL,
    "namespace" VARCHAR(50) NOT NULL,
    "sourceName" TEXT NOT NULL,
    "artistId" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artist_source_tag_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artwork_artists" (
    "id" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "artistId" INTEGER NOT NULL,

    CONSTRAINT "artwork_artists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "artwork_artist_evidence" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "evidenceKey" TEXT NOT NULL,
    "provenance" "CreatorEvidenceKind" NOT NULL,
    "sourceRefId" TEXT,
    "tagMappingId" TEXT,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "excludedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artwork_artist_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_maintenance_plans" (
    "id" TEXT NOT NULL,
    "requestedBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PREPARING',
    "maximumArtworkId" INTEGER NOT NULL DEFAULT 0,
    "command" TEXT NOT NULL,
    "input" JSONB NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "systemJobId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "creator_maintenance_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "creator_maintenance_items" (
    "id" SERIAL NOT NULL,
    "planId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "result" JSONB,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "creator_maintenance_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "artist_source_tag_mappings_artistId_idx" ON "artist_source_tag_mappings"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "artist_source_tag_mappings_providerKey_namespace_sourceName_key" ON "artist_source_tag_mappings"("providerKey", "namespace", "sourceName");

-- CreateIndex
CREATE INDEX "artwork_artists_artistId_artworkId_idx" ON "artwork_artists"("artistId", "artworkId");

-- CreateIndex
CREATE UNIQUE INDEX "artwork_artists_artworkId_artistId_key" ON "artwork_artists"("artworkId", "artistId");

-- CreateIndex
CREATE INDEX "artwork_artist_evidence_sourceRefId_idx" ON "artwork_artist_evidence"("sourceRefId");

-- CreateIndex
CREATE INDEX "artwork_artist_evidence_tagMappingId_idx" ON "artwork_artist_evidence"("tagMappingId");

-- CreateIndex
CREATE UNIQUE INDEX "artwork_artist_evidence_membershipId_evidenceKey_key" ON "artwork_artist_evidence"("membershipId", "evidenceKey");

-- CreateIndex
CREATE UNIQUE INDEX "creator_maintenance_plans_systemJobId_key" ON "creator_maintenance_plans"("systemJobId");

-- CreateIndex
CREATE INDEX "creator_maintenance_items_planId_status_id_idx" ON "creator_maintenance_items"("planId", "status", "id");

-- CreateIndex
CREATE UNIQUE INDEX "creator_maintenance_items_planId_artworkId_key" ON "creator_maintenance_items"("planId", "artworkId");

-- AddForeignKey
ALTER TABLE "artist_source_tag_mappings" ADD CONSTRAINT "artist_source_tag_mappings_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_artists" ADD CONSTRAINT "artwork_artists_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_artists" ADD CONSTRAINT "artwork_artists_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_artist_evidence" ADD CONSTRAINT "artwork_artist_evidence_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "artwork_artists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_artist_evidence" ADD CONSTRAINT "artwork_artist_evidence_sourceRefId_fkey" FOREIGN KEY ("sourceRefId") REFERENCES "artwork_external_refs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artwork_artist_evidence" ADD CONSTRAINT "artwork_artist_evidence_tagMappingId_fkey" FOREIGN KEY ("tagMappingId") REFERENCES "artist_source_tag_mappings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "creator_maintenance_items" ADD CONSTRAINT "creator_maintenance_items_planId_fkey" FOREIGN KEY ("planId") REFERENCES "creator_maintenance_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve historical attribution without claiming source ownership.
INSERT INTO artwork_artists (id, "artworkId", "artistId")
SELECT 'legacy-' || id, id, "artistId" FROM "Artwork" WHERE "artistId" IS NOT NULL;
INSERT INTO artwork_artist_evidence
  (id, "membershipId", "evidenceKey", provenance, present, "createdAt", "updatedAt")
SELECT 'legacy-' || id, 'legacy-' || id, 'legacy-column', 'LEGACY', true, now(), now()
FROM "Artwork" WHERE "artistId" IS NOT NULL;

-- All legacy ingestion paths receive an initial membership, including nested Prisma creates.
-- Updates deliberately do not reclaim attribution after the owner has curated it.
CREATE FUNCTION seed_legacy_artwork_creator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."artistId" IS NOT NULL THEN
    INSERT INTO artwork_artists (id, "artworkId", "artistId")
    VALUES ('legacy-' || NEW.id, NEW.id, NEW."artistId");
    INSERT INTO artwork_artist_evidence
      (id, "membershipId", "evidenceKey", provenance, present, "createdAt", "updatedAt")
    VALUES ('legacy-' || NEW.id, 'legacy-' || NEW.id, 'legacy-column', 'LEGACY', true, now(), now());
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER seed_legacy_artwork_creator AFTER INSERT ON "Artwork"
FOR EACH ROW EXECUTE FUNCTION seed_legacy_artwork_creator();

CREATE INDEX artwork_creator_source_date_idx ON "Artwork" (COALESCE("sourceDate", "createdAt") DESC, id DESC);

CREATE VIEW effective_artwork_creators AS
SELECT m.* FROM artwork_artists m WHERE EXISTS (
  SELECT 1 FROM artwork_artist_evidence e
  WHERE e."membershipId" = m.id AND e.present AND e."excludedAt" IS NULL
);
