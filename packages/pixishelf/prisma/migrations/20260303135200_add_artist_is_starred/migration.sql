-- AlterTable
ALTER TABLE "Artist" ADD COLUMN     "isStarred" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "Artist_isStarred_idx" ON "Artist"("isStarred");
