-- AlterTable
ALTER TABLE "Artwork" ADD COLUMN     "descriptionLength" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "directoryCreatedAt" TIMESTAMP(3),
ADD COLUMN     "imageCount" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "Artwork_directoryCreatedAt_idx" ON "Artwork"("directoryCreatedAt");

-- CreateIndex
CREATE INDEX "Artwork_imageCount_idx" ON "Artwork"("imageCount");

-- CreateIndex
CREATE INDEX "Artwork_descriptionLength_idx" ON "Artwork"("descriptionLength");
