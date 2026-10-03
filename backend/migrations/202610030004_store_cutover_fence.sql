-- Up Migration
ALTER TABLE store_bootstrap_state ADD COLUMN sync_secret_digest text
  CHECK (sync_secret_digest IS NULL OR sync_secret_digest ~ '^[0-9a-f]{64}$');

CREATE FUNCTION protect_store_sync_secret_rotation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.sync_secret_digest IS NOT NULL AND
    ((NEW.generation = OLD.generation AND
      NEW.sync_secret_digest IS DISTINCT FROM OLD.sync_secret_digest) OR
     (NEW.generation > OLD.generation AND
      NEW.sync_secret_digest IS NOT DISTINCT FROM OLD.sync_secret_digest)) THEN
    RAISE EXCEPTION 'A fenced generation requires a new synchronization secret';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_sync_secret_rotation
  BEFORE UPDATE ON store_bootstrap_state FOR EACH ROW
  EXECUTE FUNCTION protect_store_sync_secret_rotation();

ALTER TABLE store_bootstrap_audit DROP CONSTRAINT store_bootstrap_audit_action_check;
ALTER TABLE store_bootstrap_audit ADD CONSTRAINT store_bootstrap_audit_action_check
  CHECK (action IN ('snapshot.published', 'snapshot.applied', 'manager.enrolled',
    'opening.signed-off', 'cutover.issued', 'cutover.activated',
    'generation.fenced', 'generation.activated'));

-- Down Migration
ALTER TABLE store_bootstrap_audit DROP CONSTRAINT store_bootstrap_audit_action_check;
ALTER TABLE store_bootstrap_audit ADD CONSTRAINT store_bootstrap_audit_action_check
  CHECK (action IN ('snapshot.published', 'snapshot.applied', 'manager.enrolled',
    'opening.signed-off'));
DROP TRIGGER store_sync_secret_rotation ON store_bootstrap_state;
DROP FUNCTION protect_store_sync_secret_rotation();
ALTER TABLE store_bootstrap_state DROP COLUMN sync_secret_digest;
