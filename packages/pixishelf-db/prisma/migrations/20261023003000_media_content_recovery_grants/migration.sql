CREATE TYPE "MediaContentRecoveryGrantStatus" AS ENUM ('ACTIVE', 'CONSUMED', 'REVOKED');

CREATE TABLE "MediaContentRecoveryGrant" (
  id TEXT NOT NULL PRIMARY KEY,
  "jobId" TEXT NOT NULL REFERENCES system_jobs(id) ON DELETE RESTRICT ON UPDATE CASCADE,
  "sessionId" TEXT NOT NULL,
  "expectedAttempt" INTEGER NOT NULL,
  "targetAttempt" INTEGER NOT NULL,
  snapshot JSONB NOT NULL,
  "snapshotSha256" VARCHAR(64) NOT NULL,
  "backupCheckpointRef" TEXT NOT NULL,
  operator TEXT NOT NULL,
  status "MediaContentRecoveryGrantStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "consumedAt" TIMESTAMP(3),
  "consumedExecutionToken" UUID,
  "revokedAt" TIMESTAMP(3),
  "revokedBy" TEXT,
  "revocationReason" TEXT,
  CONSTRAINT media_content_recovery_grant_values_check CHECK (
    "expectedAttempt" > 0 AND "targetAttempt" = "expectedAttempt" + 1
    AND length("sessionId") BETWEEN 1 AND 4096
    AND length(operator) BETWEEN 1 AND 4096
    AND length("backupCheckpointRef") BETWEEN 1 AND 4096
    AND "snapshotSha256" ~ '^[a-f0-9]{64}$'
    AND jsonb_typeof(snapshot) = 'object' AND octet_length(snapshot::text) <= 1048576
    AND ((status = 'ACTIVE' AND "consumedAt" IS NULL AND "consumedExecutionToken" IS NULL AND "revokedAt" IS NULL AND "revokedBy" IS NULL AND "revocationReason" IS NULL)
      OR (status = 'CONSUMED' AND "consumedAt" IS NOT NULL AND "consumedExecutionToken" IS NOT NULL AND "revokedAt" IS NULL AND "revokedBy" IS NULL AND "revocationReason" IS NULL)
      OR (status = 'REVOKED' AND "consumedAt" IS NULL AND "consumedExecutionToken" IS NULL AND "revokedAt" IS NOT NULL AND "revokedBy" IS NOT NULL AND "revocationReason" IS NOT NULL))
  )
);
CREATE INDEX "MediaContentRecoveryGrant_jobId_sessionId_targetAttempt_status_idx" ON "MediaContentRecoveryGrant" ("jobId", "sessionId", "targetAttempt", status);
CREATE UNIQUE INDEX media_content_recovery_active_grant_idx ON "MediaContentRecoveryGrant" ("jobId", "sessionId") WHERE status = 'ACTIVE';
