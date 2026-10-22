CREATE TABLE "MediaMark" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "mediaId" INTEGER,
    "bookmarkedAt" TIMESTAMP(3),
    "likedAt" TIMESTAMP(3),
    "artworkTitle" TEXT NOT NULL,
    "mediaPosition" INTEGER NOT NULL,
    "mediaType" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MediaMark_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "MediaMark_has_mark_check" CHECK ("bookmarkedAt" IS NOT NULL OR "likedAt" IS NOT NULL),
    CONSTRAINT "MediaMark_position_check" CHECK ("mediaPosition" > 0),
    CONSTRAINT "MediaMark_type_check" CHECK ("mediaType" IN ('image', 'animation', 'video'))
);

CREATE UNIQUE INDEX "MediaMark_userId_mediaId_key" ON "MediaMark"("userId", "mediaId");
CREATE INDEX "MediaMark_userId_bookmarkedAt_id_idx" ON "MediaMark"("userId", "bookmarkedAt" DESC, "id" DESC);
CREATE INDEX "MediaMark_userId_likedAt_id_idx" ON "MediaMark"("userId", "likedAt" DESC, "id" DESC);
CREATE INDEX "MediaMark_artworkId_idx" ON "MediaMark"("artworkId");
CREATE INDEX "MediaMark_mediaId_idx" ON "MediaMark"("mediaId");

ALTER TABLE "MediaMark" ADD CONSTRAINT "MediaMark_userId_fkey" FOREIGN KEY ("userId") REFERENCES "UserBA"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaMark" ADD CONSTRAINT "MediaMark_artworkId_fkey" FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "MediaMark" ADD CONSTRAINT "MediaMark_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;
