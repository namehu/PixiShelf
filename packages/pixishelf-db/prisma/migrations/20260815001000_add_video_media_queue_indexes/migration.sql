-- Keep the worker's bounded probe cursor and oldest-first poster backlog queries index-backed.
ALTER TABLE "MediaVideoMetadata"
ADD COLUMN "posterBacklogCheckedAt" TIMESTAMP(3);

CREATE INDEX "MediaVideoMetadata_probeStatus_imageId_idx"
ON "MediaVideoMetadata"("probeStatus", "imageId");

CREATE INDEX "MediaVideoMetadata_poster_backlog_idx"
ON "MediaVideoMetadata"(
  "probeStatus",
  "manualPosterTimestamp",
  "posterBacklogCheckedAt" ASC NULLS FIRST,
  "imageId" ASC
);
