-- CreateEnum
CREATE TYPE "VideoPosterStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'FAILED');

-- AlterTable
ALTER TABLE "MediaVideoMetadata"
  ADD COLUMN "posterStatus" "VideoPosterStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "posterPath" TEXT,
  ADD COLUMN "posterUpdatedAt" TIMESTAMP(3),
  ADD COLUMN "posterError" TEXT;

-- CreateIndex
CREATE INDEX "MediaVideoMetadata_posterStatus_idx" ON "MediaVideoMetadata"("posterStatus");
