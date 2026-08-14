-- CreateEnum
CREATE TYPE "ChapterPreviewStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "MediaChapterPreview" (
    "id" TEXT NOT NULL,
    "imageId" INTEGER NOT NULL,
    "chapterOrder" INTEGER NOT NULL,
    "chapterIndex" INTEGER NOT NULL,
    "chaptersHash" TEXT NOT NULL,
    "chapterStart" DOUBLE PRECISION NOT NULL,
    "captureTime" DOUBLE PRECISION NOT NULL,
    "status" "ChapterPreviewStatus" NOT NULL DEFAULT 'PENDING',
    "previewPath" TEXT,
    "previewUpdatedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaChapterPreview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaChapterPreview_imageId_chapterOrder_key" ON "MediaChapterPreview"("imageId", "chapterOrder");

-- CreateIndex
CREATE INDEX "MediaChapterPreview_status_idx" ON "MediaChapterPreview"("status");

-- CreateIndex
CREATE INDEX "MediaChapterPreview_imageId_chaptersHash_idx" ON "MediaChapterPreview"("imageId", "chaptersHash");

-- AddForeignKey
ALTER TABLE "MediaChapterPreview" ADD CONSTRAINT "MediaChapterPreview_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;
