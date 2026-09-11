ALTER TABLE "pixiv_metadata_inventory_state"
  ADD COLUMN "rootIdentity" UUID;

COMMENT ON COLUMN "pixiv_metadata_inventory_state"."rootIdentity" IS
  'Persistent .pixishelf-root UUID; NULL requires verified legacy binding, never backfilled from device/inode by migration';
