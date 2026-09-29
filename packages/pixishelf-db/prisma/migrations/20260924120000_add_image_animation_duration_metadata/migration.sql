CREATE TYPE "AnimationDurationFormat" AS ENUM ('WEBP', 'GIF', 'APNG');
CREATE TYPE "AnimationDurationStatus" AS ENUM ('PENDING', 'READY', 'NOT_APPLICABLE', 'FAILED');

CREATE TABLE "ImageAnimationMetadata" (
    "imageId" INTEGER NOT NULL,
    "format" "AnimationDurationFormat",
    "durationMs" BIGINT,
    "frameCount" INTEGER,
    "loopCount" INTEGER,
    "status" "AnimationDurationStatus" NOT NULL DEFAULT 'PENDING',
    "timingPolicyVersion" INTEGER,
    "probedAt" TIMESTAMP(3),
    "sourcePath" TEXT,
    "sourceSize" BIGINT,
    "sourceMtimeMs" BIGINT,
    "sourceCtimeMs" BIGINT,
    "sourceDeviceId" BIGINT,
    "sourceInode" BIGINT,
    "sourceRevision" INTEGER NOT NULL DEFAULT 0,
    "failureCode" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3),
    "writeInProgress" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ImageAnimationMetadata_pkey" PRIMARY KEY ("imageId")
);

CREATE INDEX "ImageAnimationMetadata_status_nextRetryAt_imageId_idx"
ON "ImageAnimationMetadata"("status", "nextRetryAt", "imageId");

ALTER TABLE "ImageAnimationMetadata"
ADD CONSTRAINT "ImageAnimationMetadata_imageId_fkey"
FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;
