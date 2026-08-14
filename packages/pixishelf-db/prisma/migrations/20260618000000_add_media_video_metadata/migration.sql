-- CreateEnum
CREATE TYPE "MediaType" AS ENUM ('IMAGE', 'VIDEO', 'ANIMATION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MediaProbeStatus" AS ENUM ('PENDING', 'PROBING', 'COMPLETED', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Image" ADD COLUMN "mediaType" "MediaType" NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable
CREATE TABLE "MediaVideoMetadata" (
    "imageId" INTEGER NOT NULL,
    "probeStatus" "MediaProbeStatus" NOT NULL DEFAULT 'PENDING',
    "probeUpdatedAt" TIMESTAMP(3),
    "probeError" TEXT,
    "hasAudio" BOOLEAN,
    "audioCodec" TEXT,
    "audioChannels" INTEGER,
    "videoCodec" TEXT,
    "duration" DOUBLE PRECISION,
    "fps" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MediaVideoMetadata_pkey" PRIMARY KEY ("imageId")
);

-- CreateIndex
CREATE INDEX "Image_mediaType_idx" ON "Image"("mediaType");

-- CreateIndex
CREATE INDEX "MediaVideoMetadata_probeStatus_idx" ON "MediaVideoMetadata"("probeStatus");

-- CreateIndex
CREATE INDEX "MediaVideoMetadata_hasAudio_idx" ON "MediaVideoMetadata"("hasAudio");

-- AddForeignKey
ALTER TABLE "MediaVideoMetadata" ADD CONSTRAINT "MediaVideoMetadata_imageId_fkey" FOREIGN KEY ("imageId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;
