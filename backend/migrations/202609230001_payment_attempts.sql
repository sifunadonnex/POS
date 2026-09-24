-- Up Migration
CREATE TABLE payment_attempt (
  id uuid PRIMARY KEY,
  request_id uuid NOT NULL UNIQUE,
  actor_id text NOT NULL REFERENCES "user"(id),
  sale_id uuid NOT NULL REFERENCES sale(id),
  shift_id uuid NOT NULL REFERENCES cash_shift(id),
  kind text NOT NULL CHECK (kind IN ('card', 'mpesa')),
  provider text NOT NULL CHECK (length(provider) BETWEEN 1 AND 50),
  provider_reference text CHECK (provider_reference IS NULL OR length(provider_reference) BETWEEN 1 AND 200),
  amount_minor bigint NOT NULL CHECK (amount_minor > 0),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed', 'unknown')),
  request_fingerprint text NOT NULL CHECK (length(request_fingerprint) = 64),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  confirmed_at timestamptz,
  CHECK (
    (status = 'confirmed' AND provider_reference IS NOT NULL AND confirmed_at IS NOT NULL)
    OR (status <> 'confirmed' AND confirmed_at IS NULL)
  )
);
CREATE INDEX payment_attempt_sale ON payment_attempt (sale_id, created_at DESC);
CREATE INDEX payment_attempt_status ON payment_attempt (status, updated_at);
CREATE UNIQUE INDEX payment_attempt_provider_reference
  ON payment_attempt (provider, provider_reference)
  WHERE provider_reference IS NOT NULL;

CREATE TABLE payment_attempt_event (
  id uuid PRIMARY KEY,
  attempt_id uuid NOT NULL REFERENCES payment_attempt(id),
  source text NOT NULL CHECK (source IN ('created', 'initiation', 'reconciliation', 'callback')),
  status text NOT NULL CHECK (status IN ('pending', 'confirmed', 'failed', 'unknown')),
  provider_event_id text CHECK (provider_event_id IS NULL OR length(provider_event_id) BETWEEN 1 AND 200),
  provider_reference text CHECK (provider_reference IS NULL OR length(provider_reference) BETWEEN 1 AND 200),
  detail_code text CHECK (detail_code IS NULL OR detail_code ~ '^[a-z0-9][a-z0-9_.-]{0,99}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX payment_attempt_event_attempt
  ON payment_attempt_event (attempt_id, created_at ASC);
CREATE UNIQUE INDEX payment_attempt_event_provider_event
  ON payment_attempt_event (attempt_id, provider_event_id)
  WHERE provider_event_id IS NOT NULL;

ALTER TABLE sale_payment
  ADD COLUMN payment_attempt_id uuid UNIQUE REFERENCES payment_attempt(id);

CREATE FUNCTION protect_payment_attempt_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment attempt history cannot be deleted';
  END IF;
  IF NEW.request_id IS DISTINCT FROM OLD.request_id
     OR NEW.actor_id IS DISTINCT FROM OLD.actor_id
     OR NEW.sale_id IS DISTINCT FROM OLD.sale_id
     OR NEW.shift_id IS DISTINCT FROM OLD.shift_id
     OR NEW.kind IS DISTINCT FROM OLD.kind
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.amount_minor IS DISTINCT FROM OLD.amount_minor
     OR NEW.request_fingerprint IS DISTINCT FROM OLD.request_fingerprint
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Payment attempt identity is immutable';
  END IF;
  IF OLD.status IN ('confirmed', 'failed') THEN
    RAISE EXCEPTION 'Terminal payment attempt cannot change';
  END IF;
  IF OLD.provider_reference IS NOT NULL
     AND NEW.provider_reference IS DISTINCT FROM OLD.provider_reference THEN
    RAISE EXCEPTION 'Payment provider reference cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER payment_attempt_protected BEFORE UPDATE OR DELETE ON payment_attempt
FOR EACH ROW EXECUTE FUNCTION protect_payment_attempt_changes();

CREATE FUNCTION prevent_payment_attempt_event_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payment attempt events are append-only';
END;
$$;
CREATE TRIGGER payment_attempt_event_immutable BEFORE UPDATE OR DELETE ON payment_attempt_event
FOR EACH ROW EXECUTE FUNCTION prevent_payment_attempt_event_changes();

-- Down Migration
DROP TRIGGER payment_attempt_event_immutable ON payment_attempt_event;
DROP FUNCTION prevent_payment_attempt_event_changes();
DROP TRIGGER payment_attempt_protected ON payment_attempt;
DROP FUNCTION protect_payment_attempt_changes();
ALTER TABLE sale_payment DROP COLUMN payment_attempt_id;
DROP TABLE payment_attempt_event;
DROP TABLE payment_attempt;
