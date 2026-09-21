-- Up Migration
CREATE TABLE supplier (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 2 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_receipt (
  id uuid PRIMARY KEY,
  supplier_id uuid NOT NULL REFERENCES supplier(id),
  actor_id text NOT NULL REFERENCES "user"(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  status text NOT NULL CHECK (status IN ('received', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_receipt_supplier ON purchase_receipt (supplier_id, created_at DESC);

CREATE TABLE purchase_receipt_line (
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES purchase_receipt(id),
  product_id uuid NOT NULL REFERENCES catalogue_product(id),
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_receipt_line_receipt ON purchase_receipt_line (receipt_id, created_at DESC);

CREATE TABLE purchase_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE purchase_return (
  id uuid PRIMARY KEY,
  receipt_id uuid NOT NULL REFERENCES purchase_receipt(id),
  actor_id text NOT NULL REFERENCES "user"(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  status text NOT NULL CHECK (status IN ('returned', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_return_receipt ON purchase_return (receipt_id, created_at DESC);

CREATE TABLE purchase_return_line (
  id uuid PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES purchase_return(id),
  receipt_line_id uuid NOT NULL REFERENCES purchase_receipt_line(id),
  product_id uuid NOT NULL REFERENCES catalogue_product(id),
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  unit_cost_minor bigint NOT NULL CHECK (unit_cost_minor >= 0),
  line_total_minor bigint NOT NULL CHECK (line_total_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX purchase_return_line_return ON purchase_return_line (return_id, created_at DESC);

CREATE FUNCTION prevent_purchase_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Purchase history is append-only';
END;
$$;
CREATE TRIGGER purchase_receipt_immutable BEFORE UPDATE OR DELETE ON purchase_receipt
FOR EACH ROW EXECUTE FUNCTION prevent_purchase_changes();

CREATE TRIGGER purchase_receipt_line_immutable BEFORE UPDATE OR DELETE ON purchase_receipt_line
FOR EACH ROW EXECUTE FUNCTION prevent_purchase_changes();

CREATE TRIGGER purchase_return_immutable BEFORE UPDATE OR DELETE ON purchase_return
FOR EACH ROW EXECUTE FUNCTION prevent_purchase_changes();

CREATE TRIGGER purchase_return_line_immutable BEFORE UPDATE OR DELETE ON purchase_return_line
FOR EACH ROW EXECUTE FUNCTION prevent_purchase_changes();

-- Down Migration
DROP TRIGGER purchase_return_line_immutable ON purchase_return_line;
DROP TRIGGER purchase_return_immutable ON purchase_return;
DROP TRIGGER purchase_receipt_line_immutable ON purchase_receipt_line;
DROP TRIGGER purchase_receipt_immutable ON purchase_receipt;
DROP FUNCTION prevent_purchase_changes();
DROP TABLE purchase_return_line;
DROP TABLE purchase_return;
DROP TABLE purchase_request;
DROP TABLE purchase_receipt_line;
DROP TABLE purchase_receipt;
DROP TABLE supplier;
