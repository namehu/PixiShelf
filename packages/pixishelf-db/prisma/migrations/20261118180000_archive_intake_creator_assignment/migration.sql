ALTER TABLE "Artwork" ADD COLUMN "archiveLocalCreatorsOnly" boolean NOT NULL DEFAULT false;

ALTER TABLE "archive_intake_items"
  ADD COLUMN "localCreatorsOnly" boolean NOT NULL DEFAULT false,
  ADD COLUMN "assignedArtistIds" integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  ADD COLUMN "creatorSourceId" text,
  ADD COLUMN "creatorSourceName" text;

ALTER TABLE "archive_imports"
  ADD COLUMN "localCreatorsOnly" boolean NOT NULL DEFAULT false,
  ADD COLUMN "assignedArtistIds" integer[] NOT NULL DEFAULT ARRAY[]::integer[],
  ADD COLUMN "creatorSourceId" text,
  ADD COLUMN "creatorSourceName" text;
