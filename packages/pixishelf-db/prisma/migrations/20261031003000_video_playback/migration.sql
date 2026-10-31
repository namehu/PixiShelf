CREATE TABLE "MediaVideoPlayback" (
  "imageId" INTEGER PRIMARY KEY REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "generationId" TEXT NOT NULL UNIQUE,
  "sourcePath" TEXT NOT NULL,
  "sourceRevision" BIGINT NOT NULL,
  "sourceArtworkMediaEpoch" BIGINT NOT NULL,
  "sourceSize" BIGINT NOT NULL,
  "sourceMtimeNs" BIGINT,
  "sourceCtimeNs" BIGINT,
  "sourceDeviceId" BIGINT,
  "sourceInode" BIGINT,
  "profileVersion" INTEGER NOT NULL,
  "relativePath" TEXT NOT NULL UNIQUE,
  "outputSize" BIGINT NOT NULL,
  "duration" DOUBLE PRECISION NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Cover all Image deletion/replacement paths, including cascading deletes.
-- This only records an intent; the existing Worker performs filesystem GC.
CREATE FUNCTION queue_video_playback_gc() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW."relativePath" = OLD."relativePath" THEN RETURN NEW; END IF;
  INSERT INTO derived_media_gc_entries
    (id, "mediaKind", "relativePath", "referenceType", "referenceId", reason, status, "notBefore", "updatedAt")
  VALUES
    (gen_random_uuid()::text, 'VIDEO_PLAYBACK', OLD."relativePath", 'MEDIA_VIDEO_PLAYBACK',
     OLD."imageId"::text, 'PLAYBACK_RETIRED', 'PENDING', CURRENT_TIMESTAMP + INTERVAL '1 hour', CURRENT_TIMESTAMP)
  ON CONFLICT ("mediaKind", "relativePath") DO UPDATE SET
    reason = 'PLAYBACK_RETIRED', status = 'PENDING', "notBefore" = EXCLUDED."notBefore",
    attempt = 0, error = NULL, "deletedAt" = NULL, "updatedAt" = CURRENT_TIMESTAMP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER video_playback_gc AFTER DELETE OR UPDATE OF "relativePath" ON "MediaVideoPlayback"
  FOR EACH ROW EXECUTE FUNCTION queue_video_playback_gc();

CREATE INDEX system_jobs_video_playback_target_idx
  ON system_jobs ((payload #> '{imageId}'), "createdAt" DESC, id DESC)
  WHERE type = 'VIDEO_PLAYBACK_GENERATION' AND "definitionVersion" > 0;
