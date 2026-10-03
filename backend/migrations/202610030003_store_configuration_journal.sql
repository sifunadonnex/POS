-- Up Migration
CREATE TABLE store_configuration_journal (
  store_id uuid NOT NULL,
  version bigint NOT NULL CHECK (version > 1),
  transaction_id bigint NOT NULL,
  previous_digest text NOT NULL CHECK (previous_digest ~ '^[0-9a-f]{64}$'),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  entity text NOT NULL CHECK (entity IN ('staff', 'category', 'product', 'barcode')),
  operation text NOT NULL CHECK (operation IN ('upsert', 'delete')),
  entity_id text NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  actor_id text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, version)
);
CREATE INDEX store_configuration_journal_transaction ON store_configuration_journal
  (store_id, transaction_id, version);

ALTER TABLE store_bootstrap_state ADD COLUMN last_roster_check_at timestamptz;

CREATE TABLE store_configuration_applied (
  store_id uuid NOT NULL REFERENCES store_bootstrap_state(store_id),
  version bigint NOT NULL CHECK (version > 1),
  digest text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$'),
  entity text NOT NULL,
  operation text NOT NULL,
  entity_id text NOT NULL,
  payload jsonb NOT NULL,
  actor_id text,
  reason text,
  applied_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (store_id, version)
);

CREATE FUNCTION journal_store_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  state_row store_bootstrap_state%ROWTYPE;
  event_payload jsonb;
  entity_type text;
  event_operation text;
  entity_key text;
  actor text;
  reason_text text;
  next_digest text;
  next_version bigint;
BEGIN
  IF TG_TABLE_NAME = 'user' AND TG_OP = 'UPDATE' THEN
    IF ROW(NEW.name, NEW.email, NEW.role, NEW.disabled, NEW."emailVerified")
      IS NOT DISTINCT FROM
      ROW(OLD.name, OLD.email, OLD.role, OLD.disabled, OLD."emailVerified") THEN
      RETURN NEW;
    END IF;
  END IF;
  SELECT * INTO state_row FROM store_bootstrap_state
    WHERE singleton AND runtime_mode = 'hosted' AND configuration_version > 0
    FOR UPDATE;
  IF NOT FOUND THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  entity_type := CASE TG_TABLE_NAME
    WHEN 'user' THEN 'staff'
    WHEN 'catalogue_category' THEN 'category'
    WHEN 'catalogue_product' THEN 'product'
    WHEN 'catalogue_barcode' THEN 'barcode'
  END;
  event_operation := CASE WHEN TG_OP = 'DELETE' THEN 'delete' ELSE 'upsert' END;
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME = 'catalogue_barcode' THEN
      entity_key := OLD.code;
    ELSE
      entity_key := OLD.id::text;
    END IF;
    event_payload := jsonb_build_object('id', entity_key);
  ELSIF TG_TABLE_NAME = 'user' THEN
    entity_key := NEW.id;
    event_payload := jsonb_build_object('id', NEW.id, 'name', NEW.name,
      'email', lower(NEW.email), 'role', NEW.role, 'disabled', NEW.disabled,
      'emailVerified', NEW."emailVerified");
  ELSIF TG_TABLE_NAME = 'catalogue_category' THEN
    entity_key := NEW.id::text;
    event_payload := jsonb_build_object('id', NEW.id, 'name', NEW.name,
      'revision', NEW.revision);
  ELSIF TG_TABLE_NAME = 'catalogue_product' THEN
    entity_key := NEW.id::text;
    event_payload := jsonb_build_object('id', NEW.id, 'sku', NEW.sku,
      'name', NEW.name, 'categoryId', NEW.category_id, 'unit', NEW.unit,
      'priceMinor', NEW.price_minor::text, 'taxCode', NEW.tax_code,
      'active', NEW.active, 'revision', NEW.revision,
      'lowStockThresholdMinor', NEW.low_stock_threshold_minor::text);
  ELSE
    entity_key := NEW.code;
    event_payload := jsonb_build_object('code', NEW.code, 'productId', NEW.product_id);
  END IF;
  actor := nullif(current_setting('paygo.actor_id', true), '');
  reason_text := nullif(current_setting('paygo.reason', true), '');
  IF actor IS NULL AND entity_type = 'staff' THEN actor := entity_key; END IF;
  IF reason_text IS NULL AND entity_type = 'staff' THEN reason_text := 'authentication'; END IF;
  next_version := state_row.configuration_version + 1;
  next_digest := md5(state_row.configuration_digest || entity_type || event_operation ||
    entity_key || event_payload::text || next_version::text) ||
    md5(event_payload::text || entity_key || next_version::text || state_row.configuration_digest);
  UPDATE store_bootstrap_state SET configuration_version = next_version,
    configuration_digest = next_digest, updated_at = now() WHERE singleton;
  INSERT INTO store_configuration_journal
    (store_id, version, transaction_id, previous_digest, digest, entity,
      operation, entity_id, payload, actor_id, reason)
    VALUES (state_row.store_id, next_version, txid_current(),
      state_row.configuration_digest, next_digest, entity_type,
      event_operation, entity_key, event_payload, actor, reason_text);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER journal_staff AFTER INSERT OR UPDATE OR DELETE ON "user"
  FOR EACH ROW EXECUTE FUNCTION journal_store_configuration();
CREATE TRIGGER journal_category AFTER INSERT OR UPDATE OR DELETE ON catalogue_category
  FOR EACH ROW EXECUTE FUNCTION journal_store_configuration();
CREATE TRIGGER journal_product AFTER INSERT OR UPDATE OR DELETE ON catalogue_product
  FOR EACH ROW EXECUTE FUNCTION journal_store_configuration();
CREATE TRIGGER journal_barcode AFTER INSERT OR UPDATE OR DELETE ON catalogue_barcode
  FOR EACH ROW EXECUTE FUNCTION journal_store_configuration();

CREATE FUNCTION prevent_store_configuration_journal_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Configuration journal is append-only';
END;
$$;
CREATE TRIGGER store_configuration_journal_immutable
  BEFORE UPDATE OR DELETE ON store_configuration_journal
  FOR EACH ROW EXECUTE FUNCTION prevent_store_configuration_journal_changes();
CREATE TRIGGER store_configuration_applied_immutable
  BEFORE UPDATE OR DELETE ON store_configuration_applied
  FOR EACH ROW EXECUTE FUNCTION prevent_store_configuration_journal_changes();

CREATE FUNCTION protect_roster_check_clock() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.last_roster_check_at IS NOT NULL
    AND (NEW.last_roster_check_at IS NULL
      OR NEW.last_roster_check_at < OLD.last_roster_check_at) THEN
    RAISE EXCEPTION 'Roster freshness clock cannot move backwards';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_roster_check_clock_protected
  BEFORE UPDATE ON store_bootstrap_state
  FOR EACH ROW EXECUTE FUNCTION protect_roster_check_clock();

CREATE FUNCTION enforce_edge_roster_freshness_on_login() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE checkpoint timestamptz;
BEGIN
  SELECT s.last_roster_check_at INTO checkpoint
    FROM store_bootstrap_state s JOIN store_bootstrap_application a ON a.store_id = s.store_id
    WHERE s.singleton AND s.runtime_mode = 'edge';
  IF FOUND AND (checkpoint IS NULL OR checkpoint > now()
    OR checkpoint <= now() - interval '24 hours') THEN
    RAISE EXCEPTION 'Local staff roster must be refreshed before sign-in'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER edge_roster_freshness_on_login
  BEFORE INSERT ON session FOR EACH ROW EXECUTE FUNCTION enforce_edge_roster_freshness_on_login();

-- Down Migration
DROP TRIGGER edge_roster_freshness_on_login ON session;
DROP FUNCTION enforce_edge_roster_freshness_on_login();
DROP TRIGGER store_roster_check_clock_protected ON store_bootstrap_state;
DROP FUNCTION protect_roster_check_clock();
DROP TRIGGER store_configuration_applied_immutable ON store_configuration_applied;
DROP TRIGGER store_configuration_journal_immutable ON store_configuration_journal;
DROP FUNCTION prevent_store_configuration_journal_changes();
DROP TRIGGER journal_barcode ON catalogue_barcode;
DROP TRIGGER journal_product ON catalogue_product;
DROP TRIGGER journal_category ON catalogue_category;
DROP TRIGGER journal_staff ON "user";
DROP FUNCTION journal_store_configuration();
ALTER TABLE store_bootstrap_state DROP COLUMN last_roster_check_at;
DROP TABLE store_configuration_applied;
DROP INDEX store_configuration_journal_transaction;
DROP TABLE store_configuration_journal;
