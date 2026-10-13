-- Up Migration
ALTER TABLE "user" ADD COLUMN archived_at timestamptz;
ALTER TABLE "user" ADD CONSTRAINT removed_staff_disabled CHECK (archived_at IS NULL OR disabled);

-- Down Migration
ALTER TABLE "user" DROP CONSTRAINT removed_staff_disabled;
ALTER TABLE "user" DROP COLUMN archived_at;
