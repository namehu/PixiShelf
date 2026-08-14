CREATE TYPE "ScheduleMode" AS ENUM ('DAILY');

CREATE TABLE "scheduled_tasks" (
    "id" TEXT NOT NULL,
    "key" VARCHAR(80) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "scheduleMode" "ScheduleMode" NOT NULL DEFAULT 'DAILY',
    "time" VARCHAR(5) NOT NULL,
    "timezone" VARCHAR(50) NOT NULL DEFAULT 'Asia/Shanghai',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "mutexKey" VARCHAR(80),
    "lastTriggeredAt" TIMESTAMP(3),
    "lastTriggeredDate" VARCHAR(10),
    "lastJobId" TEXT,
    "config" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scheduled_tasks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "scheduled_tasks_key_key" ON "scheduled_tasks"("key");
CREATE INDEX "scheduled_tasks_enabled_priority_idx" ON "scheduled_tasks"("enabled", "priority");
CREATE INDEX "scheduled_tasks_type_idx" ON "scheduled_tasks"("type");
CREATE INDEX "scheduled_tasks_mutexKey_idx" ON "scheduled_tasks"("mutexKey");
