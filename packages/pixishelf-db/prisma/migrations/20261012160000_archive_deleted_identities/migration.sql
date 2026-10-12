ALTER TABLE "archive_imports" ADD COLUMN "publishedArtworkDeletedAt" TIMESTAMP(3),
  ADD COLUMN "publishedArtworkPurgedAt" TIMESTAMP(3);
ALTER TYPE "ArchiveBulkOperationCommand" ADD VALUE 'RESTORE_ARCHIVE';
ALTER TYPE "ArchiveBulkOperationTarget" ADD VALUE 'ARCHIVE_ARTWORK';

CREATE TABLE "archive_deleted_identities" (
  "providerKey" VARCHAR(50) NOT NULL,
  "externalId" TEXT NOT NULL,
  "canonicalUrl" TEXT NOT NULL,
  "artworkId" INTEGER NOT NULL,
  "deletedAt" TIMESTAMP(3) NOT NULL,
  "purgedAt" TIMESTAMP(3),
  PRIMARY KEY ("providerKey", "externalId")
);
CREATE INDEX "archive_deleted_identities_canonicalUrl_idx" ON "archive_deleted_identities" ("canonicalUrl");
CREATE INDEX "archive_deleted_identities_artworkId_idx" ON "archive_deleted_identities" ("artworkId");
CREATE INDEX "archive_imports_visible_created_idx" ON "archive_imports" ("createdAt" DESC, id DESC)
  WHERE "publishedArtworkDeletedAt" IS NULL;
CREATE INDEX "artwork_archive_trash_deleted_idx" ON "Artwork" ("deletedAt" DESC, id DESC)
  WHERE "createdVia" = 'URL_ARCHIVE' AND "deletedAt" IS NOT NULL;

-- Keep the durable disposition in the same transaction as the lifecycle transition.
-- BEFORE DELETE sees references before FK cascades; filesystem purge has already succeeded.
CREATE FUNCTION preserve_archive_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_id INTEGER;
  deleted_at TIMESTAMP(3);
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."createdVia" <> 'URL_ARCHIVE' OR OLD."deletedAt" IS NULL THEN RETURN OLD; END IF;
    target_id := OLD.id;
    deleted_at := OLD."deletedAt";
  ELSE
    IF NEW."createdVia" <> 'URL_ARCHIVE' THEN RETURN NEW; END IF;
    target_id := NEW.id;
    deleted_at := NEW."deletedAt";
    IF deleted_at IS NULL AND NEW."archiveLifecycleState" = 'ACTIVE' THEN
      DELETE FROM "archive_deleted_identities" WHERE "artworkId" = target_id;
      UPDATE "archive_imports" SET "publishedArtworkDeletedAt" = NULL, "publishedArtworkPurgedAt" = NULL
        WHERE "publishedArtworkId" = target_id;
      RETURN NEW;
    END IF;
    IF deleted_at IS NULL THEN RETURN NEW; END IF;
  END IF;

  INSERT INTO "archive_deleted_identities" ("providerKey", "externalId", "canonicalUrl", "artworkId", "deletedAt", "purgedAt")
    SELECT "providerKey", "externalId", "canonicalUrl", target_id, deleted_at,
      CASE WHEN TG_OP = 'DELETE' THEN clock_timestamp()::timestamp ELSE NULL END
    FROM "artwork_external_refs" WHERE "artworkId" = target_id
    ON CONFLICT ("providerKey", "externalId") DO UPDATE SET
      "canonicalUrl" = EXCLUDED."canonicalUrl", "artworkId" = EXCLUDED."artworkId", "deletedAt" = EXCLUDED."deletedAt", "purgedAt" = EXCLUDED."purgedAt";
  UPDATE "archive_imports" SET "publishedArtworkDeletedAt" = deleted_at,
    "publishedArtworkPurgedAt" = CASE WHEN TG_OP = 'DELETE' THEN clock_timestamp()::timestamp ELSE NULL END
    WHERE "publishedArtworkId" = target_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artwork_preserve_archive_deletion
  BEFORE UPDATE OF "deletedAt", "archiveLifecycleState" OR DELETE ON "Artwork"
  FOR EACH ROW EXECUTE FUNCTION preserve_archive_deletion();

-- Only a successful publication clears a prior deletion; failed/cancelled reimports do not.
CREATE FUNCTION clear_published_archive_deletion() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = 'COMPLETED' AND NEW."publishedArtworkId" IS NOT NULL
    AND (OLD.status IS DISTINCT FROM NEW.status OR OLD."publishedArtworkId" IS DISTINCT FROM NEW."publishedArtworkId") THEN
    DELETE FROM "archive_deleted_identities"
      WHERE "providerKey" = NEW."providerKey" AND "externalId" = NEW."externalId";
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER archive_import_clear_published_deletion
  AFTER UPDATE OF status, "publishedArtworkId" ON "archive_imports"
  FOR EACH ROW EXECUTE FUNCTION clear_published_archive_deletion();

-- Only existing soft-deleted artworks provide unambiguous historical evidence.
INSERT INTO "archive_deleted_identities" ("providerKey", "externalId", "canonicalUrl", "artworkId", "deletedAt")
  SELECT r."providerKey", r."externalId", r."canonicalUrl", a.id, a."deletedAt"
  FROM "artwork_external_refs" r JOIN "Artwork" a ON a.id = r."artworkId"
  WHERE a."createdVia" = 'URL_ARCHIVE' AND a."deletedAt" IS NOT NULL;
UPDATE "archive_imports" i SET "publishedArtworkDeletedAt" = a."deletedAt"
  FROM "Artwork" a WHERE i."publishedArtworkId" = a.id
  AND a."createdVia" = 'URL_ARCHIVE' AND a."deletedAt" IS NOT NULL;
