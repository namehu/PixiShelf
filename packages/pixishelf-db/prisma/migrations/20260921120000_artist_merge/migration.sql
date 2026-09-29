ALTER TABLE "Artist" ADD COLUMN "mergedIntoId" INTEGER, ADD COLUMN "mergedAt" TIMESTAMP(3);
ALTER TABLE "Artist" ADD CONSTRAINT "Artist_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Artist"(id) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Artist" ADD CONSTRAINT artist_merge_not_self CHECK ("mergedIntoId" IS NULL OR "mergedIntoId" <> id);
ALTER TABLE "Artist" ADD CONSTRAINT artist_merge_timestamp CHECK (("mergedIntoId" IS NULL) = ("mergedAt" IS NULL));
CREATE INDEX "Artist_mergedIntoId_idx" ON "Artist"("mergedIntoId");
CREATE TABLE artist_merges (
  id TEXT PRIMARY KEY,
  "sourceArtistId" INTEGER NOT NULL,
  "targetArtistId" INTEGER NOT NULL,
  "requestedBy" TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'READY',
  fingerprint TEXT NOT NULL,
  summary JSONB NOT NULL,
  before JSONB NOT NULL,
  after JSONB,
  "systemJobId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "artist_merges_systemJobId_key" ON artist_merges("systemJobId");
CREATE INDEX "artist_merges_createdAt_idx" ON artist_merges("createdAt");

-- Statement locks precede row locks. Protect all producers, including legacy SQL,
-- against a catalog change between checking an identity and publishing it.
CREATE FUNCTION lock_artist_merge_catalog() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(7341902118);
  RETURN NULL;
END $$;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['Artist', 'Artwork', 'artwork_artists', 'artwork_artist_evidence',
    'artist_external_refs', 'artist_source_tag_mappings', 'LocalImportArtistMapping',
    'discovery_source_creators', 'discovery_pending_creators', 'discovery_creator_suppressions',
    'archive_uploader_scan_runs', 'creator_maintenance_plans'] LOOP
    EXECUTE format('CREATE TRIGGER artist_merge_catalog_lock BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH STATEMENT EXECUTE FUNCTION lock_artist_merge_catalog()', table_name);
  END LOOP;
END $$;
CREATE TRIGGER artist_job_enqueue_lock BEFORE INSERT ON system_jobs FOR EACH STATEMENT EXECUTE FUNCTION lock_artist_merge_catalog();

CREATE FUNCTION assert_available_artist(artist_id INTEGER) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "Artist" WHERE id = artist_id AND "mergedIntoId" IS NOT NULL) THEN
    RAISE EXCEPTION '艺术家已合并，请刷新后重新选择 (ID: %)', artist_id;
  END IF;
END $$;
CREATE FUNCTION guard_artist_merge_reference() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM assert_available_artist(NEW."artistId");
  RETURN NEW;
END $$;
DO $$ DECLARE table_name TEXT; BEGIN
  FOREACH table_name IN ARRAY ARRAY['artwork_artists', 'artist_external_refs', 'artist_source_tag_mappings',
    'LocalImportArtistMapping', 'discovery_source_creators', 'discovery_pending_creators', 'discovery_creator_suppressions'] LOOP
    EXECUTE format('CREATE TRIGGER artist_merge_reference_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_artist_merge_reference()', table_name);
  END LOOP;
END $$;

CREATE FUNCTION guard_merged_artist() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."mergedIntoId" IS NOT NULL THEN RAISE EXCEPTION '艺术家已合并，请刷新后重新选择'; END IF;
  IF TG_OP = 'UPDATE' AND NEW."mergedIntoId" IS NOT NULL THEN
    PERFORM assert_available_artist(NEW."mergedIntoId");
    IF NOT EXISTS (SELECT 1 FROM "Artist" WHERE id = NEW."mergedIntoId" AND kind = NEW.kind) THEN
      RAISE EXCEPTION '合并目标不存在或类型不匹配';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER merged_artist_guard BEFORE UPDATE OR DELETE ON "Artist" FOR EACH ROW EXECUTE FUNCTION guard_merged_artist();

CREATE FUNCTION resolve_merged_artist(artist_id INTEGER) RETURNS INTEGER LANGUAGE plpgsql AS $$
DECLARE next_id INTEGER; seen INTEGER[] := ARRAY[]::INTEGER[];
BEGIN
  LOOP
    IF artist_id = ANY(seen) THEN RAISE EXCEPTION '艺术家合并链存在循环'; END IF;
    seen := array_append(seen, artist_id);
    SELECT "mergedIntoId" INTO next_id FROM "Artist" WHERE id = artist_id;
    IF next_id IS NULL THEN RETURN artist_id; END IF;
    artist_id := next_id;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION seed_legacy_artwork_creator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."artistId" IS NOT NULL THEN
    INSERT INTO artwork_artists (id, "artworkId", "artistId") VALUES ('legacy-' || NEW.id, NEW.id, resolve_merged_artist(NEW."artistId"));
    INSERT INTO artwork_artist_evidence (id, "membershipId", "evidenceKey", provenance, present, "createdAt", "updatedAt")
    VALUES ('legacy-' || NEW.id, 'legacy-' || NEW.id, 'legacy-column', 'LEGACY', true, now(), now());
  END IF;
  RETURN NEW;
END $$;

-- Explicit IDs in frozen commands cannot be resurrected by retry/resume.
CREATE FUNCTION assert_artist_command(payload JSONB) RETURNS void LANGUAGE plpgsql AS $$
DECLARE pair RECORD; element JSONB;
BEGIN
  IF jsonb_typeof(payload) = 'object' THEN
    FOR pair IN SELECT * FROM jsonb_each(payload) LOOP
      IF pair.key IN ('artistId', 'sourceArtistId', 'targetArtistId') AND jsonb_typeof(pair.value) = 'number' THEN
        PERFORM assert_available_artist((pair.value::TEXT)::INTEGER);
      ELSIF pair.key IN ('artistIds', 'creatorIds', 'defaultCreatorIds') AND jsonb_typeof(pair.value) = 'array' THEN
        FOR element IN SELECT * FROM jsonb_array_elements(pair.value) LOOP
          IF jsonb_typeof(element) = 'number' THEN PERFORM assert_available_artist((element::TEXT)::INTEGER); END IF;
        END LOOP;
      ELSE PERFORM assert_artist_command(pair.value);
      END IF;
    END LOOP;
  ELSIF jsonb_typeof(payload) = 'array' THEN
    FOR element IN SELECT * FROM jsonb_array_elements(payload) LOOP PERFORM assert_artist_command(element); END LOOP;
  END IF;
END $$;
CREATE FUNCTION guard_artist_job_command() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command JSONB; snapshot INTEGER[]; artist_id INTEGER;
BEGIN
  IF NEW.status::TEXT IN ('PENDING', 'RUNNING', 'RETRY_WAIT') AND
     (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status OR OLD.payload IS DISTINCT FROM NEW.payload) THEN
    PERFORM pg_advisory_xact_lock(7341902118);
    PERFORM assert_artist_command(NEW.payload);
    IF NEW.type = 'CREATOR_MAINTENANCE' THEN
      SELECT input INTO command FROM creator_maintenance_plans WHERE id = NEW.payload->>'planId';
      PERFORM assert_artist_command(command);
    END IF;
    SELECT "defaultCreatorIds" INTO snapshot FROM archive_uploader_scan_runs WHERE "systemJobId" = NEW.id;
    IF snapshot IS NOT NULL THEN FOREACH artist_id IN ARRAY snapshot LOOP PERFORM assert_available_artist(artist_id); END LOOP; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artist_job_command_guard BEFORE INSERT OR UPDATE ON system_jobs FOR EACH ROW EXECUTE FUNCTION guard_artist_job_command();
CREATE FUNCTION guard_artist_scan_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artist_id INTEGER;
BEGIN
  IF TG_OP = 'INSERT' OR OLD."defaultCreatorIds" IS DISTINCT FROM NEW."defaultCreatorIds" THEN
    FOREACH artist_id IN ARRAY NEW."defaultCreatorIds" LOOP PERFORM assert_available_artist(artist_id); END LOOP;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER artist_scan_snapshot_guard BEFORE INSERT OR UPDATE ON archive_uploader_scan_runs FOR EACH ROW EXECUTE FUNCTION guard_artist_scan_snapshot();
