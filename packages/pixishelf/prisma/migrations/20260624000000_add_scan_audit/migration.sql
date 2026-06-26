-- CreateEnum
CREATE TYPE "ScanRunType" AS ENUM ('PIXIV');

-- CreateEnum
CREATE TYPE "ScanRunMode" AS ENUM ('FULL', 'INCREMENTAL', 'CLIENT_LIST', 'RESCAN', 'LOCAL_RESCAN');

-- CreateEnum
CREATE TYPE "ScanRunStatus" AS ENUM ('RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ScanRunItemStatus" AS ENUM ('SUCCESS', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "ScanRunItemAction" AS ENUM ('CREATE', 'UPDATE', 'SKIP_EXISTING', 'SKIP_INVALID_METADATA', 'SKIP_NO_MEDIA', 'FAILED_PARSE', 'FAILED_COLLECT', 'FAILED_WRITE');

-- CreateTable
CREATE TABLE "scan_runs" (
    "id" TEXT NOT NULL,
    "systemJobId" TEXT,
    "type" "ScanRunType" NOT NULL,
    "mode" "ScanRunMode" NOT NULL,
    "status" "ScanRunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "totalArtworks" INTEGER NOT NULL DEFAULT 0,
    "processedArtworks" INTEGER NOT NULL DEFAULT 0,
    "succeededArtworks" INTEGER NOT NULL DEFAULT 0,
    "skippedArtworks" INTEGER NOT NULL DEFAULT 0,
    "failedArtworks" INTEGER NOT NULL DEFAULT 0,
    "newArtists" INTEGER NOT NULL DEFAULT 0,
    "newTags" INTEGER NOT NULL DEFAULT 0,
    "newImages" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "logRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scan_run_items" (
    "id" TEXT NOT NULL,
    "scanRunId" TEXT NOT NULL,
    "externalId" TEXT,
    "title" TEXT,
    "artistName" TEXT,
    "relativeDirectory" TEXT,
    "metadataRelativePath" TEXT,
    "status" "ScanRunItemStatus" NOT NULL,
    "action" "ScanRunItemAction" NOT NULL,
    "mediaCount" INTEGER NOT NULL DEFAULT 0,
    "newImageCount" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scan_run_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scan_runs_startedAt_idx" ON "scan_runs"("startedAt");

-- CreateIndex
CREATE INDEX "scan_runs_status_startedAt_idx" ON "scan_runs"("status", "startedAt");

-- CreateIndex
CREATE INDEX "scan_runs_type_mode_startedAt_idx" ON "scan_runs"("type", "mode", "startedAt");

-- CreateIndex
CREATE INDEX "scan_runs_systemJobId_idx" ON "scan_runs"("systemJobId");

-- CreateIndex
CREATE INDEX "scan_run_items_scanRunId_status_idx" ON "scan_run_items"("scanRunId", "status");

-- CreateIndex
CREATE INDEX "scan_run_items_scanRunId_action_idx" ON "scan_run_items"("scanRunId", "action");

-- CreateIndex
CREATE INDEX "scan_run_items_externalId_idx" ON "scan_run_items"("externalId");

-- AddForeignKey
ALTER TABLE "scan_runs" ADD CONSTRAINT "scan_runs_systemJobId_fkey" FOREIGN KEY ("systemJobId") REFERENCES "system_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_run_items" ADD CONSTRAINT "scan_run_items_scanRunId_fkey" FOREIGN KEY ("scanRunId") REFERENCES "scan_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
