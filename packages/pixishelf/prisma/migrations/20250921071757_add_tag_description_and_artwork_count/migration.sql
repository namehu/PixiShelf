-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "artworkCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "description" TEXT;

-- CreateIndex
CREATE INDEX "Tag_artworkCount_idx" ON "Tag"("artworkCount");
