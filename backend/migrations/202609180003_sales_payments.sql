-- Up Migration
CREATE TABLE sale_payment (
  id uuid PRIMARY KEY,
  sale_id uuid NOT NULL REFERENCES sale(id),
  kind text NOT NULL CHECK (kind IN ('cash', 'card', 'mpesa')),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL CHECK (status IN ('paid', 'refunded', 'failed')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sale_payment_sale ON sale_payment (sale_id, created_at DESC);

CREATE TABLE sale_payment_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION prevent_sale_payment_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Sale payment history is append-only';
END;
$$;
CREATE TRIGGER sale_payment_immutable BEFORE UPDATE OR DELETE ON sale_payment
FOR EACH ROW EXECUTE FUNCTION prevent_sale_payment_changes();

-- Down Migration
DROP TRIGGER sale_payment_immutable ON sale_payment;
DROP FUNCTION prevent_sale_payment_changes();
DROP TABLE sale_payment_request;
DROP TABLE sale_payment;
