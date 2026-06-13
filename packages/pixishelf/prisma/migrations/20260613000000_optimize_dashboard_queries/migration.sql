-- Support the dashboard's per-artist recent artwork lookup.
CREATE INDEX "Artwork_artistId_sourceDate_id_idx"
ON "Artwork"("artistId", "sourceDate" DESC, "id" DESC);
