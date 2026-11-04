-- Release separately, only after acceptance and at least seven days of production observation.
-- Copy this SQL unchanged into a new formal Prisma migration, then run db:deploy.
BEGIN;
DROP TABLE reading_legacy_v1.artwork_read_media RESTRICT;
DROP TABLE reading_legacy_v1.artwork_reading_summaries RESTRICT;
DROP SCHEMA reading_legacy_v1 RESTRICT;
COMMIT;
