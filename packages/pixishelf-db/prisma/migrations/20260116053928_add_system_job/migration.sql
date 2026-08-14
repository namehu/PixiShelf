-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'CANCELLING');

-- CreateTable
CREATE TABLE "system_jobs" (
    "id" TEXT NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "progress" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "result" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "system_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "system_jobs_type_status_idx" ON "system_jobs"("type", "status");

-- CreateIndex
CREATE INDEX "system_jobs_createdAt_idx" ON "system_jobs"("createdAt");
