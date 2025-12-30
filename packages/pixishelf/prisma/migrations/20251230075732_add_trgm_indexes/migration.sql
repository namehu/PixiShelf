-- CreateIndex
CREATE INDEX "Artist_name_idx" ON "Artist" USING GIN ("name" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Artwork_title_idx" ON "Artwork" USING GIN ("title" gin_trgm_ops);

-- CreateIndex
CREATE INDEX "Artwork_description_idx" ON "Artwork" USING GIN ("description" gin_trgm_ops);
