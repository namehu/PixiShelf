-- Read only. This is the phase 2 gate after the observation period, not the source/target equality check.
BEGIN READ ONLY;
SELECT current_database() AS database, current_timestamp AS checked_at;
SELECT migration_name, finished_at, current_timestamp - finished_at AS elapsed_since_phase1
FROM _prisma_migrations WHERE migration_name='20261104010000_reading_position_progress'
  AND finished_at IS NOT NULL AND rolled_back_at IS NULL;
SELECT 'artwork_reading_summaries' AS sealed_table, count(*) AS rows FROM reading_legacy_v1.artwork_reading_summaries
UNION ALL SELECT 'artwork_read_media', count(*) FROM reading_legacy_v1.artwork_read_media;
SELECT c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE n.nspname='reading_legacy_v1' ORDER BY c.relkind,c.relname;
DO $$
BEGIN
 IF NOT EXISTS (SELECT 1 FROM _prisma_migrations WHERE migration_name='20261104010000_reading_position_progress'
  AND finished_at IS NOT NULL AND rolled_back_at IS NULL) THEN
  RAISE EXCEPTION 'Phase 1 has no successful Prisma history'; END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE contype='f' AND (
  conrelid IN ('reading_legacy_v1.artwork_reading_summaries'::regclass, 'reading_legacy_v1.artwork_read_media'::regclass)
  OR confrelid IN ('reading_legacy_v1.artwork_reading_summaries'::regclass, 'reading_legacy_v1.artwork_read_media'::regclass))) THEN
  RAISE EXCEPTION 'Sealed tables still participate in foreign keys'; END IF;
 IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','reading_legacy_v1') AND p.prosrc ~ 'artwork_reading_summaries|artwork_read_media')
 OR EXISTS (SELECT 1 FROM pg_views WHERE schemaname NOT IN ('pg_catalog','information_schema','reading_legacy_v1') AND definition ~ 'artwork_reading_summaries|artwork_read_media')
 OR EXISTS (SELECT 1 FROM pg_matviews WHERE schemaname NOT IN ('pg_catalog','information_schema','reading_legacy_v1') AND definition ~ 'artwork_reading_summaries|artwork_read_media') THEN
  RAISE EXCEPTION 'A business function or view still reads sealed tables'; END IF;
 IF EXISTS (SELECT 1 FROM pg_depend d JOIN pg_rewrite r ON d.classid='pg_rewrite'::regclass AND r.oid=d.objid
  JOIN pg_class c ON c.oid=r.ev_class JOIN pg_namespace n ON n.oid=c.relnamespace
  WHERE n.nspname NOT IN ('pg_catalog','information_schema','reading_legacy_v1') AND d.refobjid IN ('reading_legacy_v1.artwork_reading_summaries'::regclass, 'reading_legacy_v1.artwork_read_media'::regclass)) THEN
  RAISE EXCEPTION 'A business view depends on sealed tables'; END IF;
END $$;
COMMIT;
