ALTER TABLE "system_jobs"
ADD COLUMN "targetImageId" INTEGER,
ADD COLUMN "targetPath" TEXT,
ADD COLUMN "mode" VARCHAR(50);

CREATE INDEX "system_jobs_type_targetImageId_createdAt_idx"
ON "system_jobs"("type", "targetImageId", "createdAt");
