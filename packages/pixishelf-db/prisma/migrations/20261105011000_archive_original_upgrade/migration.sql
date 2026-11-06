-- Additive, server-frozen quality-upgrade intents. Existing tasks retain their original meaning.
ALTER TABLE archive_intake_items ADD COLUMN "upgradeBaseRevisionId" TEXT, ADD COLUMN "upgradeSnapshot" JSONB;
ALTER TABLE archive_imports ADD COLUMN "upgradeBaseRevisionId" TEXT, ADD COLUMN "upgradeSnapshot" JSONB;
ALTER TABLE archive_intake_items ADD CONSTRAINT archive_intake_upgrade_intent_check
  CHECK (("upgradeBaseRevisionId" IS NULL) = ("upgradeSnapshot" IS NULL)
    AND NOT ("upgradeBaseRevisionId" IS NOT NULL AND "completionBaseRevisionId" IS NOT NULL));
ALTER TABLE archive_imports ADD CONSTRAINT archive_import_upgrade_intent_check
  CHECK (("upgradeBaseRevisionId" IS NULL) = ("upgradeSnapshot" IS NULL)
    AND NOT ("upgradeBaseRevisionId" IS NOT NULL AND "completionBaseRevisionId" IS NOT NULL));
CREATE INDEX archive_intake_items_upgrade_base_idx ON archive_intake_items ("upgradeBaseRevisionId");
