CREATE TYPE "TagExternalMetadataStatus" AS ENUM ('SUCCESS', 'PARTIAL', 'NO_DATA', 'FAILED');

CREATE TABLE "tag_external_metadata" (
  "id" TEXT NOT NULL,
  "tagId" INTEGER NOT NULL,
  "providerKey" VARCHAR(50) NOT NULL,
  "lookupKey" VARCHAR(255) NOT NULL,
  "status" "TagExternalMetadataStatus" NOT NULL,
  "normalizedPayload" JSONB,
  "payloadHash" VARCHAR(64),
  "lastAttemptAt" TIMESTAMP(3) NOT NULL,
  "lastSuccessAt" TIMESTAMP(3),
  "lastErrorCode" VARCHAR(80),
  "lastError" TEXT,
  "lastSystemJobId" VARCHAR(30),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "tag_external_metadata_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "tag_external_metadata_payload_hash_check" CHECK (
    "payloadHash" IS NULL OR "payloadHash" ~ '^[a-f0-9]{64}$'
  ),
  CONSTRAINT "tag_external_metadata_lookup_key_check" CHECK (length("lookupKey") > 0)
);

CREATE UNIQUE INDEX "tag_external_metadata_tagId_providerKey_key"
  ON "tag_external_metadata"("tagId", "providerKey");

CREATE INDEX "tag_external_metadata_providerKey_status_lastAttemptAt_idx"
  ON "tag_external_metadata"("providerKey", "status", "lastAttemptAt");

CREATE INDEX "tag_external_metadata_lastSystemJobId_idx"
  ON "tag_external_metadata"("lastSystemJobId");

ALTER TABLE "tag_external_metadata"
  ADD CONSTRAINT "tag_external_metadata_tagId_fkey"
  FOREIGN KEY ("tagId") REFERENCES "Tag"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
