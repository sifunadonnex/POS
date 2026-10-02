-- Up Migration
ALTER TABLE sync_outbox DROP CONSTRAINT sync_outbox_schema_version_check;
ALTER TABLE sync_outbox
  ADD CONSTRAINT sync_outbox_schema_version_check
  CHECK (schema_version IN (1, 2));

ALTER TABLE sync_inbox DROP CONSTRAINT sync_inbox_schema_version_check;
ALTER TABLE sync_inbox
  ADD CONSTRAINT sync_inbox_schema_version_check
  CHECK (schema_version IN (1, 2));

CREATE TABLE sync_cash_sale_projection (
  event_id uuid PRIMARY KEY REFERENCES sync_inbox (id),
  store_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  cashier_id text NOT NULL CHECK (length(cashier_id) BETWEEN 1 AND 255),
  cashier_name text NOT NULL CHECK (length(cashier_name) BETWEEN 1 AND 160),
  shift_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  total_minor bigint NOT NULL CHECK (total_minor > 0),
  payment_id uuid NOT NULL,
  tendered_minor bigint NOT NULL CHECK (tendered_minor >= total_minor),
  change_minor bigint NOT NULL CHECK (change_minor = tendered_minor - total_minor),
  projected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, sale_id),
  UNIQUE (store_id, payment_id)
);

CREATE INDEX sync_cash_sale_projection_store_occurred
  ON sync_cash_sale_projection (store_id, occurred_at DESC, event_id);

CREATE INDEX sync_cash_sale_projection_store_cashier_occurred
  ON sync_cash_sale_projection (store_id, cashier_id, occurred_at DESC);

CREATE TABLE sync_cash_sale_line_projection (
  event_id uuid NOT NULL REFERENCES sync_cash_sale_projection (event_id),
  line_number smallint NOT NULL CHECK (line_number > 0),
  product_id uuid NOT NULL,
  product_name text NOT NULL CHECK (length(product_name) BETWEEN 1 AND 160),
  sku text NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  unit text NOT NULL CHECK (unit IN ('each', 'pack', 'kg', 'l')),
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  PRIMARY KEY (event_id, line_number)
);

CREATE FUNCTION prevent_sync_projection_changes()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'synchronized reporting projections are append-only';
END;
$$;

CREATE TRIGGER sync_cash_sale_projection_append_only
  BEFORE UPDATE OR DELETE ON sync_cash_sale_projection
  FOR EACH ROW EXECUTE FUNCTION prevent_sync_projection_changes();

CREATE TRIGGER sync_cash_sale_line_projection_append_only
  BEFORE UPDATE OR DELETE ON sync_cash_sale_line_projection
  FOR EACH ROW EXECUTE FUNCTION prevent_sync_projection_changes();

-- Down Migration
DROP TRIGGER sync_cash_sale_line_projection_append_only ON sync_cash_sale_line_projection;
DROP TRIGGER sync_cash_sale_projection_append_only ON sync_cash_sale_projection;
DROP FUNCTION prevent_sync_projection_changes();
DROP TABLE sync_cash_sale_line_projection;
DROP TABLE sync_cash_sale_projection;
ALTER TABLE sync_inbox DROP CONSTRAINT sync_inbox_schema_version_check;
ALTER TABLE sync_inbox
  ADD CONSTRAINT sync_inbox_schema_version_check CHECK (schema_version = 1);
ALTER TABLE sync_outbox DROP CONSTRAINT sync_outbox_schema_version_check;
ALTER TABLE sync_outbox
  ADD CONSTRAINT sync_outbox_schema_version_check CHECK (schema_version = 1);
