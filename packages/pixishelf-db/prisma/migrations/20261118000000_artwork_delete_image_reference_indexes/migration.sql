BEGIN;

CREATE INDEX "Image_delete_path_prefix_idx" ON "Image" ("path" COLLATE "C");
CREATE INDEX "Image_delete_chapters_path_prefix_idx" ON "Image" ("chaptersPath" COLLATE "C")
  WHERE "chaptersPath" IS NOT NULL;

COMMIT;
