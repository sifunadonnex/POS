-- Up Migration
CREATE TABLE store_bootstrap_publication (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL,
  generation integer NOT NULL CHECK (generation > 0),
  configuration_version bigint NOT NULL CHECK (configuration_version > 0),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  signature text NOT NULL CHECK (signature ~ '^[0-9a-f]{64}$'),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  publisher_id text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL CHECK (expires_at > created_at)
);
CREATE INDEX store_bootstrap_publication_store ON store_bootstrap_publication
  (store_id, created_at DESC);

ALTER TABLE store_bootstrap_state ADD COLUMN opening_stock_at timestamptz;

CREATE TABLE store_bootstrap_application (
  store_id uuid PRIMARY KEY REFERENCES store_bootstrap_state(store_id),
  publication_id uuid NOT NULL UNIQUE,
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  publisher_id text NOT NULL REFERENCES "user"(id),
  snapshot_payload jsonb NOT NULL CHECK (jsonb_typeof(snapshot_payload) = 'object'),
  proposed_stock jsonb NOT NULL CHECK (jsonb_typeof(proposed_stock) = 'array'),
  applied_at timestamptz NOT NULL DEFAULT now(),
  manager_enrolled_at timestamptz,
  opening_request_id uuid UNIQUE,
  opening_digest text CHECK (opening_digest IS NULL OR opening_digest ~ '^[0-9a-f]{64}$'),
  opening_actor_id text REFERENCES "user"(id),
  opening_at timestamptz,
  CHECK ((opening_request_id IS NULL AND opening_digest IS NULL
    AND opening_actor_id IS NULL AND opening_at IS NULL)
    OR (opening_request_id IS NOT NULL AND opening_digest IS NOT NULL
      AND opening_actor_id IS NOT NULL AND opening_at IS NOT NULL))
);

CREATE FUNCTION protect_store_bootstrap_application() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.publication_id IS DISTINCT FROM OLD.publication_id
    OR NEW.digest IS DISTINCT FROM OLD.digest
    OR NEW.publisher_id IS DISTINCT FROM OLD.publisher_id
    OR NEW.snapshot_payload IS DISTINCT FROM OLD.snapshot_payload
    OR NEW.proposed_stock IS DISTINCT FROM OLD.proposed_stock
    OR NEW.applied_at IS DISTINCT FROM OLD.applied_at
    OR (OLD.manager_enrolled_at IS NOT NULL
      AND NEW.manager_enrolled_at IS DISTINCT FROM OLD.manager_enrolled_at)
    OR (OLD.opening_request_id IS NOT NULL AND
      (NEW.opening_request_id IS DISTINCT FROM OLD.opening_request_id
        OR NEW.opening_digest IS DISTINCT FROM OLD.opening_digest
        OR NEW.opening_actor_id IS DISTINCT FROM OLD.opening_actor_id
        OR NEW.opening_at IS DISTINCT FROM OLD.opening_at)) THEN
    RAISE EXCEPTION 'Store bootstrap application cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_bootstrap_application_protected
  BEFORE UPDATE ON store_bootstrap_application
  FOR EACH ROW EXECUTE FUNCTION protect_store_bootstrap_application();

CREATE FUNCTION protect_store_opening_checkpoint() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.opening_stock_at IS NOT NULL
    AND NEW.opening_stock_at IS DISTINCT FROM OLD.opening_stock_at THEN
    RAISE EXCEPTION 'Opening stock checkpoint cannot be rewritten';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_bootstrap_opening_protected
  BEFORE UPDATE ON store_bootstrap_state
  FOR EACH ROW EXECUTE FUNCTION protect_store_opening_checkpoint();

CREATE TABLE store_bootstrap_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  store_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN
    ('snapshot.published', 'snapshot.applied', 'manager.enrolled', 'opening.signed-off')),
  actor_id text NOT NULL,
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION prevent_store_bootstrap_history_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Store bootstrap history is append-only';
END;
$$;
CREATE TRIGGER store_bootstrap_publication_immutable
  BEFORE UPDATE OR DELETE ON store_bootstrap_publication
  FOR EACH ROW EXECUTE FUNCTION prevent_store_bootstrap_history_changes();
CREATE TRIGGER store_bootstrap_audit_immutable
  BEFORE UPDATE OR DELETE ON store_bootstrap_audit
  FOR EACH ROW EXECUTE FUNCTION prevent_store_bootstrap_history_changes();

-- Down Migration
DROP TRIGGER store_bootstrap_audit_immutable ON store_bootstrap_audit;
DROP TRIGGER store_bootstrap_publication_immutable ON store_bootstrap_publication;
DROP FUNCTION prevent_store_bootstrap_history_changes();
DROP TABLE store_bootstrap_audit;
DROP TRIGGER store_bootstrap_opening_protected ON store_bootstrap_state;
DROP FUNCTION protect_store_opening_checkpoint();
DROP TRIGGER store_bootstrap_application_protected ON store_bootstrap_application;
DROP FUNCTION protect_store_bootstrap_application();
DROP TABLE store_bootstrap_application;
DROP INDEX store_bootstrap_publication_store;
DROP TABLE store_bootstrap_publication;
ALTER TABLE store_bootstrap_state DROP COLUMN opening_stock_at;
