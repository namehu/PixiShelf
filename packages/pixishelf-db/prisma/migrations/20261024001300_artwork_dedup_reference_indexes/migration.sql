-- Indexed canonical references support bounded manifest pages across the whole catalog.
CREATE INDEX "Image_dedup_canonical_path_idx" ON "Image" ((ltrim(replace(path,chr(92),'/'),'/')));
CREATE INDEX "Image_dedup_canonical_chapters_idx" ON "Image" ((ltrim(replace("chaptersPath",chr(92),'/'),'/'))) WHERE "chaptersPath" IS NOT NULL;
CREATE INDEX "Artwork_dedup_canonical_meta_idx" ON "Artwork" ((ltrim(replace("metaSource",chr(92),'/'),'/'))) WHERE "metaSource" IS NOT NULL;
CREATE INDEX "archive_revisions_dedup_canonical_manifest_idx" ON archive_revisions ((ltrim(replace("manifestPath",chr(92),'/'),'/')));
CREATE INDEX "archive_import_items_dedup_staged_path_idx" ON archive_import_items ("archiveImportId","stagedPath");
