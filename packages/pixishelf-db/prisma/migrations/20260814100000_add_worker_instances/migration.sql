BEGIN;

CREATE TYPE "WorkerInstanceStatus" AS ENUM (
  'STARTING',
  'READY',
  'DEGRADED',
  'STOPPING'
);

CREATE TABLE "worker_instances" (
  "workerId" VARCHAR(120) NOT NULL,
  "status" "WorkerInstanceStatus" NOT NULL DEFAULT 'STARTING',
  "serviceVersion" VARCHAR(50) NOT NULL,
  "hostname" VARCHAR(255) NOT NULL,
  "processId" INTEGER NOT NULL,
  "capabilities" JSONB,
  "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastError" TEXT,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "worker_instances_pkey" PRIMARY KEY ("workerId")
);

CREATE INDEX "worker_instances_status_heartbeatAt_idx"
  ON "worker_instances"("status", "heartbeatAt");

COMMIT;
