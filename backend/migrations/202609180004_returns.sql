-- Up Migration
CREATE TABLE sale_return (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES sale(id),
  actor_id text NOT NULL REFERENCES "user"(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  total_minor bigint NOT NULL CHECK (total_minor >= 0),
  status text NOT NULL CHECK (status IN ('requested', 'approved', 'completed', 'rejected')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_return_sale ON sale_return (sale_id, created_at DESC);

CREATE TABLE sale_return_line (
  id uuid PRIMARY KEY,
  return_id uuid NOT NULL REFERENCES sale_return(id),
  sale_line_id uuid NOT NULL REFERENCES sale_line(id),
  product_id uuid NOT NULL REFERENCES catalogue_product(id),
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_return_line_return ON sale_return_line (return_id, created_at DESC);

CREATE TABLE sale_refund (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES sale(id),
  return_id uuid NOT NULL REFERENCES sale_return(id),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  status text NOT NULL CHECK (status IN ('paid', 'failed', 'reversed')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_refund_sale ON sale_refund (sale_id, created_at DESC);

CREATE TABLE sale_return_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION prevent_sale_return_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sale return history is append-only';
END;
$$;
CREATE TRIGGER sale_return_immutable BEFORE UPDATE OR DELETE ON sale_return
FOR EACH ROW EXECUTE FUNCTION prevent_sale_return_changes();

CREATE TRIGGER sale_return_line_immutable BEFORE UPDATE OR DELETE ON sale_return_line
FOR EACH ROW EXECUTE FUNCTION prevent_sale_return_changes();

CREATE TRIGGER sale_refund_immutable BEFORE UPDATE OR DELETE ON sale_refund
FOR EACH ROW EXECUTE FUNCTION prevent_sale_return_changes();

-- Down Migration
DROP TRIGGER sale_refund_immutable ON sale_refund;
DROP TRIGGER sale_return_line_immutable ON sale_return_line;
DROP TRIGGER sale_return_immutable ON sale_return;
DROP FUNCTION prevent_sale_return_changes();
DROP TABLE sale_return_request;
DROP TABLE sale_refund;
DROP TABLE sale_return_line;
DROP TABLE sale_return;
