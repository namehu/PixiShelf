-- Store normalized Pixiv JSON metadata fields while keeping legacy txt scans compatible.
ALTER TABLE "Artwork"
ADD COLUMN "metadataFormat" TEXT,
ADD COLUMN "pixivAiType" INTEGER,
ADD COLUMN "pixivType" INTEGER,
ADD COLUMN "sanityLevel" INTEGER;

CREATE INDEX "Artwork_metadataFormat_idx" ON "Artwork"("metadataFormat");

CREATE TABLE "ArtworkRawMetadata" (
    "id" SERIAL NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "rawMetadataJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ArtworkRawMetadata_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ArtworkRawMetadata_artworkId_key" ON "ArtworkRawMetadata"("artworkId");
CREATE INDEX "ArtworkRawMetadata_artworkId_idx" ON "ArtworkRawMetadata"("artworkId");

ALTER TABLE "ArtworkRawMetadata"
ADD CONSTRAINT "ArtworkRawMetadata_artworkId_fkey"
FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
