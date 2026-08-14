-- Derived images are reproducible caches. Reset their database references so the
-- new common storage root and hierarchical chapter paths are populated by jobs.
UPDATE "MediaVideoMetadata"
SET
  "posterStatus" = 'PENDING',
  "posterPath" = NULL,
  "posterUpdatedAt" = NULL,
  "posterError" = NULL;

DELETE FROM "MediaChapterPreview";
