-- Up Migration
CREATE TABLE sale (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  status text NOT NULL CHECK (status IN ('completed', 'voided')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sale_line (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES sale(id),
  product_id uuid NOT NULL REFERENCES catalogue_product(id),
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_line_sale ON sale_line (sale_id, created_at DESC);

CREATE TABLE sale_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION prevent_sale_history_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sale history is append-only';
END;
$$;
CREATE TRIGGER sale_immutable BEFORE UPDATE OR DELETE ON sale
FOR EACH ROW EXECUTE FUNCTION prevent_sale_history_changes();

CREATE TRIGGER sale_line_immutable BEFORE UPDATE OR DELETE ON sale_line
FOR EACH ROW EXECUTE FUNCTION prevent_sale_history_changes();

-- Down Migration
DROP TRIGGER sale_line_immutable ON sale_line;
DROP TRIGGER sale_immutable ON sale;
DROP FUNCTION prevent_sale_history_changes();
DROP TABLE sale_request;
DROP TABLE sale_line;
DROP TABLE sale;
