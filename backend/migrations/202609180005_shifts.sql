-- Up Migration
CREATE TABLE cash_shift (
  id uuid PRIMARY KEY,
  cashier_id text NOT NULL REFERENCES "user"(id),
  opening_cash_minor bigint NOT NULL CHECK (opening_cash_minor >= 0),
  closing_cash_minor bigint CHECK (closing_cash_minor >= 0),
  variance_minor bigint CHECK (variance_minor >= -2147483648),
  status text NOT NULL CHECK (status IN ('open', 'closed')),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  opened_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_shift_cashier ON cash_shift (cashier_id, opened_at DESC);

CREATE TABLE cash_movement (
  id uuid PRIMARY KEY,
  shift_id uuid NOT NULL REFERENCES cash_shift(id),
  kind text NOT NULL CHECK (kind IN ('opening', 'closing', 'cash_in', 'cash_out')),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX cash_movement_shift ON cash_movement (shift_id, created_at DESC);

CREATE TABLE shift_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION prevent_shift_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shift history is append-only';
END;
$$;
CREATE TRIGGER cash_shift_immutable BEFORE UPDATE OR DELETE ON cash_shift
FOR EACH ROW EXECUTE FUNCTION prevent_shift_changes();

CREATE TRIGGER cash_movement_immutable BEFORE UPDATE OR DELETE ON cash_movement
FOR EACH ROW EXECUTE FUNCTION prevent_shift_changes();

-- Down Migration
DROP TRIGGER cash_movement_immutable ON cash_movement;
DROP TRIGGER cash_shift_immutable ON cash_shift;
DROP FUNCTION prevent_shift_changes();
DROP TABLE shift_request;
DROP TABLE cash_movement;
DROP TABLE cash_shift;
