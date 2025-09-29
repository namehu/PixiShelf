-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "name_zh" TEXT,
ADD COLUMN     "search_vector" tsvector;

-- CreateIndex
CREATE INDEX "Tag_name_zh_idx" ON "Tag"("name_zh");

-- CreateIndex
CREATE INDEX "Tag_search_vector_idx" ON "Tag" USING GIN ("search_vector");
