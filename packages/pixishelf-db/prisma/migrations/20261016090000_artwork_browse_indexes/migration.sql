-- Fixed random ring: the expression and C collation must match random-page-query.ts.
CREATE INDEX "artwork_active_random_v1_idx" ON "Artwork"
  ((md5(id::text || ':artwork-random-v1') COLLATE "C"), id)
  WHERE "deletedAt" IS NULL AND "archiveLifecycleState" = 'ACTIVE';

CREATE INDEX "Image_artworkId_sortOrder_id_idx" ON "Image" ("artworkId", "sortOrder", id);
