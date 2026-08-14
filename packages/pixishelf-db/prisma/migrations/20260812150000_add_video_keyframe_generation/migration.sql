-- CreateEnum
CREATE TYPE "VideoKeyframeSetStatus" AS ENUM ('STAGING', 'PUBLISHED', 'FAILED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JobStatus" ADD VALUE IF NOT EXISTS 'PAUSING' BEFORE 'PAUSED';

-- CreateEnum
CREATE TYPE "VideoKeyframeStatus" AS ENUM ('PENDING', 'GENERATING', 'COMPLETED', 'REJECTED', 'FAILED');

-- AlterTable
ALTER TABLE "MediaVideoMetadata"
ADD COLUMN "manualPosterTimestamp" DOUBLE PRECISION,
ADD COLUMN "manualPosterSourceSize" BIGINT,
ADD COLUMN "manualPosterSourceMtimeMs" BIGINT,
ADD COLUMN "manualPosterWarning" TEXT;

-- AlterTable
ALTER TABLE "system_jobs"
ADD COLUMN "parentJobId" TEXT,
ADD COLUMN "queuePriority" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN "availableAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "MediaVideoKeyframeSet" (
    "id" TEXT NOT NULL,
    "imageId" INTEGER NOT NULL,
    "systemJobId" TEXT,
    "status" "VideoKeyframeSetStatus" NOT NULL DEFAULT 'STAGING',
    "sourceSize" BIGINT NOT NULL,
    "sourceMtimeMs" BIGINT NOT NULL,
    "policyVersion" INTEGER NOT NULL,
    "duration" DOUBLE PRECISION NOT NULL,
    "targetCount" INTEGER NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "completedCandidates" INTEGER NOT NULL DEFAULT 0,
    "publishedCount" INTEGER NOT NULL DEFAULT 0,
    "warning" TEXT,
    "error" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaVideoKeyframeSet_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaVideoKeyframe" (
    "id" TEXT NOT NULL,
    "setId" TEXT NOT NULL,
    "candidateIndex" INTEGER NOT NULL,
    "captureTime" DOUBLE PRECISION NOT NULL,
    "path" TEXT,
    "status" "VideoKeyframeStatus" NOT NULL DEFAULT 'PENDING',
    "luma" DOUBLE PRECISION,
    "sharpness" DOUBLE PRECISION,
    "perceptualHash" VARCHAR(64),
    "rejectionReason" VARCHAR(80),
    "selectedOrder" INTEGER,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaVideoKeyframe_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MediaVideoKeyframeSet_systemJobId_key" ON "MediaVideoKeyframeSet"("systemJobId");
CREATE INDEX "MediaVideoKeyframeSet_imageId_status_idx" ON "MediaVideoKeyframeSet"("imageId", "status");
CREATE INDEX "MediaVideoKeyframeSet_status_updatedAt_idx" ON "MediaVideoKeyframeSet"("status", "updatedAt");
CREATE UNIQUE INDEX "MediaVideoKeyframe_setId_candidateIndex_key" ON "MediaVideoKeyframe"("setId", "candidateIndex");
CREATE INDEX "MediaVideoKeyframe_setId_status_idx" ON "MediaVideoKeyframe"("setId", "status");
CREATE INDEX "MediaVideoKeyframe_setId_selectedOrder_idx" ON "MediaVideoKeyframe"("setId", "selectedOrder");
CREATE INDEX "system_jobs_parentJobId_status_idx" ON "system_jobs"("parentJobId", "status");
CREATE INDEX "system_jobs_type_status_queuePriority_availableAt_createdAt_idx" ON "system_jobs"("type", "status", "queuePriority", "availableAt", "createdAt");

-- AddForeignKey
ALTER TABLE "system_jobs" ADD CONSTRAINT "system_jobs_parentJobId_fkey" FOREIGN KEY ("parentJobId") REFERENCES "system_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaVideoKeyframeSet" ADD CONSTRAINT "MediaVideoKeyframeSet_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaVideoKeyframeSet" ADD CONSTRAINT "MediaVideoKeyframeSet_systemJobId_fkey" FOREIGN KEY ("systemJobId") REFERENCES "system_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "MediaVideoKeyframe" ADD CONSTRAINT "MediaVideoKeyframe_setId_fkey" FOREIGN KEY ("setId") REFERENCES "MediaVideoKeyframeSet"("id") ON DELETE CASCADE ON UPDATE CASCADE;
