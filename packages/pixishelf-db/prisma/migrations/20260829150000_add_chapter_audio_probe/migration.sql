-- Persist measured chapter audibility separately from legacy chapters.json stream-presence metadata.
ALTER TABLE "MediaChapterPreview"
ADD COLUMN "hasAudibleAudio" BOOLEAN,
ADD COLUMN "audioChaptersHash" TEXT,
ADD COLUMN "audioProbeError" TEXT;
