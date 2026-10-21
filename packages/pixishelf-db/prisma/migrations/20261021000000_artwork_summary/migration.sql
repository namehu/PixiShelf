CREATE TABLE "ArtworkSummary" (
  "artworkId" INTEGER PRIMARY KEY REFERENCES "Artwork"("id") ON DELETE CASCADE,
  "sourceRevision" INTEGER NOT NULL DEFAULT 0,
  "generationId" TEXT,
  "publishedRevision" INTEGER,
  "algorithmVersion" INTEGER,
  "groups" JSONB,
  "jobId" TEXT,
  "replaceInProgress" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "ArtworkSummaryFeature" (
  "imageId" INTEGER PRIMARY KEY REFERENCES "Image"("id") ON DELETE CASCADE,
  "sourceKey" TEXT,
  "feature" JSONB,
  "algorithmVersion" INTEGER,
  "generationId" TEXT,
  "failureCode" TEXT,
  "sourceRevision" INTEGER NOT NULL DEFAULT 0,
  "writeInProgress" BOOLEAN NOT NULL DEFAULT false,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Invalidate only content/sequence changes, not timestamps or unrelated metadata.
CREATE FUNCTION invalidate_artwork_visual_summary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND
    ROW(OLD."artworkId", OLD.path, OLD.size, OLD.width, OLD.height, OLD."sortOrder", OLD."mediaType", OLD."webpAnimationStatus")
    IS NOT DISTINCT FROM
    ROW(NEW."artworkId", NEW.path, NEW.size, NEW.width, NEW.height, NEW."sortOrder", NEW."mediaType", NEW."webpAnimationStatus")
  THEN RETURN NEW; END IF;
  IF TG_OP <> 'INSERT' THEN
    UPDATE "ArtworkSummary" SET "sourceRevision" = "sourceRevision" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "artworkId" = OLD."artworkId";
  END IF;
  IF TG_OP <> 'DELETE' AND (TG_OP = 'INSERT' OR NEW."artworkId" IS DISTINCT FROM OLD."artworkId") THEN
    UPDATE "ArtworkSummary" SET "sourceRevision" = "sourceRevision" + 1, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "artworkId" = NEW."artworkId";
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER image_invalidate_visual_summary AFTER INSERT OR UPDATE OR DELETE ON "Image"
FOR EACH ROW EXECUTE FUNCTION invalidate_artwork_visual_summary();
