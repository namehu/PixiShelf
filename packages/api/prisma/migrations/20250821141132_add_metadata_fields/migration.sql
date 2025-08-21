-- AlterTable
ALTER TABLE "Artwork" ADD COLUMN     "bookmarkCount" INTEGER,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "isAiGenerated" BOOLEAN,
ADD COLUMN     "originalUrl" TEXT,
ADD COLUMN     "size" TEXT,
ADD COLUMN     "sourceDate" TIMESTAMP(3),
ADD COLUMN     "sourceUrl" TEXT,
ADD COLUMN     "thumbnailUrl" TEXT,
ADD COLUMN     "xRestrict" TEXT;

-- CreateIndex
CREATE INDEX "Artwork_externalId_idx" ON "Artwork"("externalId");
