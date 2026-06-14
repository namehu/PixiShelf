-- AlterEnum
ALTER TYPE "ArtworkSource" ADD VALUE IF NOT EXISTS 'LOCAL_IMPORT';

-- AlterTable
ALTER TABLE "Artwork" ADD COLUMN "storagePath" TEXT;

-- CreateTable
CREATE TABLE "LocalImportArtistMapping" (
    "id" SERIAL NOT NULL,
    "artistDirectory" TEXT NOT NULL,
    "artistId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocalImportArtistMapping_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Artwork_storagePath_key" ON "Artwork"("storagePath");

-- CreateIndex
CREATE UNIQUE INDEX "LocalImportArtistMapping_artistDirectory_key" ON "LocalImportArtistMapping"("artistDirectory");

-- CreateIndex
CREATE INDEX "LocalImportArtistMapping_artistId_idx" ON "LocalImportArtistMapping"("artistId");

-- AddForeignKey
ALTER TABLE "LocalImportArtistMapping" ADD CONSTRAINT "LocalImportArtistMapping_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;
