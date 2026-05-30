-- Add chapter metadata fields for video images.
ALTER TABLE "Image"
ADD COLUMN "chaptersPath" TEXT,
ADD COLUMN "chaptersCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "chaptersDuration" DOUBLE PRECISION,
ADD COLUMN "chaptersUpdatedAt" TIMESTAMP(3),
ADD COLUMN "chaptersHash" TEXT;

CREATE INDEX "Image_chaptersPath_idx" ON "Image"("chaptersPath");
