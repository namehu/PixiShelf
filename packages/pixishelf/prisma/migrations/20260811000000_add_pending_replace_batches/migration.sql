CREATE TYPE "PendingReplaceBatchStatus" AS ENUM (
  'PREVIEWED',
  'RUNNING',
  'CANCELLING',
  'COMPLETED',
  'PARTIAL_FAILED',
  'CANCELLED'
);

CREATE TYPE "PendingReplaceItemStatus" AS ENUM (
  'READY',
  'INVALID',
  'EXCLUDED',
  'STAGING',
  'BACKING_UP',
  'SWAPPING',
  'COMMITTING',
  'SUCCESS',
  'ROLLING_BACK',
  'RESTORING',
  'RESTORE_SWAPPING',
  'FAILED',
  'RESTORED',
  'BACKUP_CLEANED'
);

CREATE TABLE "pending_replace_batches" (
  "id" TEXT NOT NULL,
  "systemJobId" TEXT,
  "status" "PendingReplaceBatchStatus" NOT NULL DEFAULT 'PREVIEWED',
  "sourceRoot" TEXT NOT NULL,
  "totalItems" INTEGER NOT NULL DEFAULT 0,
  "readyItems" INTEGER NOT NULL DEFAULT 0,
  "invalidItems" INTEGER NOT NULL DEFAULT 0,
  "excludedItems" INTEGER NOT NULL DEFAULT 0,
  "succeededItems" INTEGER NOT NULL DEFAULT 0,
  "failedItems" INTEGER NOT NULL DEFAULT 0,
  "restoredItems" INTEGER NOT NULL DEFAULT 0,
  "backupBytes" BIGINT NOT NULL DEFAULT 0,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pending_replace_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "pending_replace_items" (
  "id" TEXT NOT NULL,
  "batchId" TEXT NOT NULL,
  "artworkId" INTEGER,
  "externalId" TEXT,
  "artworkTitle" TEXT,
  "artistName" TEXT,
  "sourceDirectory" TEXT NOT NULL,
  "sourceDirectoryName" TEXT NOT NULL,
  "targetDirectory" TEXT,
  "status" "PendingReplaceItemStatus" NOT NULL,
  "included" BOOLEAN NOT NULL DEFAULT true,
  "fingerprint" TEXT,
  "sourceManifest" JSONB NOT NULL,
  "oldMediaSnapshot" JSONB NOT NULL,
  "newMediaSnapshot" JSONB NOT NULL,
  "targetFileSnapshot" JSONB NOT NULL,
  "warnings" JSONB NOT NULL,
  "error" TEXT,
  "backupDirectory" TEXT,
  "completedDirectory" TEXT,
  "startedAt" TIMESTAMP(3),
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "pending_replace_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "pending_replace_batches_systemJobId_key" ON "pending_replace_batches"("systemJobId");
CREATE INDEX "pending_replace_batches_status_createdAt_idx" ON "pending_replace_batches"("status", "createdAt");
CREATE INDEX "pending_replace_batches_createdAt_idx" ON "pending_replace_batches"("createdAt");
CREATE INDEX "pending_replace_items_batchId_status_idx" ON "pending_replace_items"("batchId", "status");
CREATE INDEX "pending_replace_items_artworkId_idx" ON "pending_replace_items"("artworkId");
CREATE INDEX "pending_replace_items_externalId_idx" ON "pending_replace_items"("externalId");

ALTER TABLE "pending_replace_batches"
  ADD CONSTRAINT "pending_replace_batches_systemJobId_fkey"
  FOREIGN KEY ("systemJobId") REFERENCES "system_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "pending_replace_items"
  ADD CONSTRAINT "pending_replace_items_batchId_fkey"
  FOREIGN KEY ("batchId") REFERENCES "pending_replace_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
