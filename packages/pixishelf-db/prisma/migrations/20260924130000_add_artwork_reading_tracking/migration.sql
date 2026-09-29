ALTER TABLE "Artwork"
ADD COLUMN "mediaRevision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "Artwork"
ADD CONSTRAINT "Artwork_mediaRevision_positive_check" CHECK ("mediaRevision" >= 1);

CREATE TABLE "artwork_reading_summaries" (
    "userId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "viewCount" INTEGER NOT NULL DEFAULT 0,
    "seenCount" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "lastViewedAt" TIMESTAMP(3) NOT NULL,
    "lastActiveAt" TIMESTAMP(3) NOT NULL,
    "lastMediaId" INTEGER,
    "lastMediaIndex" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "artwork_reading_summaries_pkey" PRIMARY KEY ("userId", "artworkId"),
    CONSTRAINT "artwork_reading_summaries_counts_check"
      CHECK ("viewCount" >= 0 AND "seenCount" >= 0 AND "totalCount" >= 0 AND "seenCount" <= "totalCount"),
    CONSTRAINT "artwork_reading_summaries_last_index_check"
      CHECK ("lastMediaIndex" IS NULL OR "lastMediaIndex" >= 0)
);

CREATE INDEX "artwork_reading_summaries_user_recent_idx"
ON "artwork_reading_summaries"("userId", "lastViewedAt" DESC, "artworkId" DESC);

CREATE INDEX "artwork_reading_summaries_artworkId_idx"
ON "artwork_reading_summaries"("artworkId");

CREATE INDEX "artwork_reading_summaries_lastMediaId_idx"
ON "artwork_reading_summaries"("lastMediaId");

ALTER TABLE "artwork_reading_summaries"
ADD CONSTRAINT "artwork_reading_summaries_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "UserBA"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "artwork_reading_summaries"
ADD CONSTRAINT "artwork_reading_summaries_artworkId_fkey"
FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "artwork_reading_summaries"
ADD CONSTRAINT "artwork_reading_summaries_lastMediaId_fkey"
FOREIGN KEY ("lastMediaId") REFERENCES "Image"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "artwork_read_media" (
    "userId" TEXT NOT NULL,
    "artworkId" INTEGER NOT NULL,
    "mediaId" INTEGER NOT NULL,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "artwork_read_media_pkey" PRIMARY KEY ("userId", "artworkId", "mediaId")
);

CREATE INDEX "artwork_read_media_artworkId_idx"
ON "artwork_read_media"("artworkId");

CREATE INDEX "artwork_read_media_mediaId_idx"
ON "artwork_read_media"("mediaId");

ALTER TABLE "artwork_read_media"
ADD CONSTRAINT "artwork_read_media_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "UserBA"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "artwork_read_media"
ADD CONSTRAINT "artwork_read_media_artworkId_fkey"
FOREIGN KEY ("artworkId") REFERENCES "Artwork"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "artwork_read_media"
ADD CONSTRAINT "artwork_read_media_mediaId_fkey"
FOREIGN KEY ("mediaId") REFERENCES "Image"("id") ON DELETE CASCADE ON UPDATE CASCADE;
