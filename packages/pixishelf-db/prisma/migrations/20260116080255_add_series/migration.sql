-- AlterTable
ALTER TABLE "Artwork" ADD COLUMN     "seriesId" INTEGER;

-- CreateTable
CREATE TABLE "Series" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "coverImageUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Series_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SeriesArtwork" (
    "seriesId" INTEGER NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "sortOrder" INTEGER NOT NULL
);

-- CreateIndex
CREATE INDEX "SeriesArtwork_seriesId_idx" ON "SeriesArtwork"("seriesId");

-- CreateIndex
CREATE INDEX "SeriesArtwork_artworkId_idx" ON "SeriesArtwork"("artworkId");

-- CreateIndex
CREATE UNIQUE INDEX "SeriesArtwork_seriesId_artworkId_key" ON "SeriesArtwork"("seriesId", "artworkId");

-- AddForeignKey
ALTER TABLE "Artwork" ADD CONSTRAINT "Artwork_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesArtwork" ADD CONSTRAINT "SeriesArtwork_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "Series"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SeriesArtwork" ADD CONSTRAINT "SeriesArtwork_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
