CREATE TYPE "ArtistExternalRefStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'NO_DATA', 'FAILED');

CREATE TABLE "artist_external_refs" (
  "id" TEXT NOT NULL,
  "artistId" INTEGER NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" TEXT NOT NULL,
  "canonicalUrl" TEXT,
  "sourceName" TEXT,
  "status" "ArtistExternalRefStatus",
  "normalizedPayload" JSONB,
  "payloadHash" VARCHAR(64),
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "lastError" TEXT,
  "lastSystemJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "artist_external_refs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "artist_external_refs_provider_key_check" CHECK (length(btrim("providerKey")) > 0),
  CONSTRAINT "artist_external_refs_external_id_check" CHECK (length(btrim("externalId")) > 0),
  CONSTRAINT "artist_external_refs_payload_hash_check" CHECK (
    "payloadHash" IS NULL OR "payloadHash" ~ '^[a-f0-9]{64}$'
  )
);

CREATE UNIQUE INDEX "artist_external_refs_providerKey_externalId_key"
  ON "artist_external_refs"("providerKey", "externalId");
CREATE UNIQUE INDEX "artist_external_refs_artistId_providerKey_key"
  ON "artist_external_refs"("artistId", "providerKey");
CREATE INDEX "artist_external_refs_providerKey_status_lastAttemptAt_idx"
  ON "artist_external_refs"("providerKey", "status", "lastAttemptAt");
CREATE INDEX "artist_external_refs_lastSystemJobId_idx"
  ON "artist_external_refs"("lastSystemJobId");

ALTER TABLE "artist_external_refs"
  ADD CONSTRAINT "artist_external_refs_artistId_fkey"
  FOREIGN KEY ("artistId") REFERENCES "Artist"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Only claim a legacy numeric userId when exactly one Artist owns that id and the
-- Artist has at least one Artwork with an explicit Pixiv source reference.
WITH strong_candidates AS MATERIALIZED (
  SELECT DISTINCT artist.id AS "artistId", artist."userId" AS "externalId"
  FROM "Artist" artist
  JOIN "Artwork" artwork ON artwork."artistId" = artist.id
  JOIN "artwork_external_refs" artwork_ref
    ON artwork_ref."artworkId" = artwork.id
   AND artwork_ref."providerKey" = 'pixiv'
  WHERE artist."userId" ~ '^[1-9][0-9]*$'
),
unique_legacy_ids AS MATERIALIZED (
  SELECT "userId" AS "externalId"
  FROM "Artist"
  WHERE "userId" ~ '^[1-9][0-9]*$'
  GROUP BY "userId"
  HAVING count(*) = 1
)
INSERT INTO "artist_external_refs" (
  "id",
  "artistId",
  "providerKey",
  "externalId",
  "canonicalUrl",
  "createdAt",
  "updatedAt"
)
SELECT
  'artist_ref_' || md5('pixiv:' || candidate."externalId"),
  candidate."artistId",
  'pixiv',
  candidate."externalId",
  'https://www.pixiv.net/users/' || candidate."externalId",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
FROM strong_candidates candidate
JOIN unique_legacy_ids unique_id ON unique_id."externalId" = candidate."externalId";
