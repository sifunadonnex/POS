-- Up Migration
CREATE TABLE suspended_order (
  id uuid PRIMARY KEY,
  owner_id text NOT NULL REFERENCES "user"(id),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 160),
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'resumed', 'cancelled')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  resumed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (
    (status = 'held' AND resumed_at IS NULL AND cancelled_at IS NULL)
    OR (status = 'resumed' AND resumed_at IS NOT NULL AND cancelled_at IS NULL)
    OR (status = 'cancelled' AND resumed_at IS NULL AND cancelled_at IS NOT NULL)
  )
);
CREATE INDEX suspended_order_open
  ON suspended_order (owner_id, created_at DESC) WHERE status = 'held';

CREATE TABLE suspended_order_line (
  id uuid PRIMARY KEY,
  suspended_order_id uuid NOT NULL REFERENCES suspended_order(id),
  product_id uuid NOT NULL REFERENCES catalogue_product(id),
  unit text NOT NULL CHECK (unit IN ('each', 'pack', 'kg', 'l')),
  quantity_minor bigint NOT NULL CHECK (quantity_minor > 0),
  position integer NOT NULL CHECK (position >= 0),
  UNIQUE (suspended_order_id, product_id),
  UNIQUE (suspended_order_id, position)
);

CREATE TABLE suspended_order_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  fingerprint text NOT NULL CHECK (length(fingerprint) = 64),
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION protect_suspended_order_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Suspended order history cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
     OR NEW.note IS DISTINCT FROM OLD.note
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Suspended order identity is immutable';
  END IF;
  IF OLD.status <> 'held' OR NEW.status NOT IN ('resumed', 'cancelled') THEN
    RAISE EXCEPTION 'Suspended order transition is not allowed';
  END IF;
  IF NEW.revision <> OLD.revision + 1 THEN
    RAISE EXCEPTION 'Suspended order revision must advance once';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER suspended_order_protected BEFORE UPDATE OR DELETE ON suspended_order
FOR EACH ROW EXECUTE FUNCTION protect_suspended_order_changes();

CREATE FUNCTION prevent_suspended_order_line_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Suspended order lines are immutable';
END;
$$;
CREATE TRIGGER suspended_order_line_immutable BEFORE UPDATE OR DELETE ON suspended_order_line
FOR EACH ROW EXECUTE FUNCTION prevent_suspended_order_line_changes();

-- Down Migration
DROP TRIGGER suspended_order_line_immutable ON suspended_order_line;
DROP FUNCTION prevent_suspended_order_line_changes();
DROP TRIGGER suspended_order_protected ON suspended_order;
DROP FUNCTION protect_suspended_order_changes();
DROP TABLE suspended_order_request;
DROP TABLE suspended_order_line;
DROP TABLE suspended_order;
