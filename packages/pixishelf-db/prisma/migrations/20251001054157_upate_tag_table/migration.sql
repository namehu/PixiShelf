-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "abstract" TEXT,
ADD COLUMN     "image" TEXT,
ADD COLUMN     "name_en" TEXT;

-- CreateIndex
CREATE INDEX "Tag_name_en_idx" ON "Tag"("name_en");
