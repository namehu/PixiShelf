CREATE INDEX "Image_mp4_artwork_id_idx"
  ON "Image" ("artworkId" DESC, "id" DESC)
  WHERE lower(path) LIKE '%.mp4';
