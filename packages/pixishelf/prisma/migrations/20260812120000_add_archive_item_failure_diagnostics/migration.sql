ALTER TABLE "archive_import_items"
  ADD COLUMN "errorStage" VARCHAR(40),
  ADD COLUMN "remoteHost" VARCHAR(300);
