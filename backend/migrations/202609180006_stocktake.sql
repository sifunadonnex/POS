-- Up Migration
CREATE TABLE stocktake (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES catalogue_product(id),
  counted_quantity_minor bigint NOT NULL CHECK (counted_quantity_minor >= 0),
  previous_quantity_minor bigint NOT NULL CHECK (previous_quantity_minor >= 0),
  delta_minor bigint NOT NULL,
  actor_id text NOT NULL REFERENCES "user"(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX stocktake_product ON stocktake (product_id, created_at DESC);

CREATE TABLE stocktake_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION prevent_stocktake_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Stocktake history is append-only';
END;
$$;
CREATE TRIGGER stocktake_immutable BEFORE UPDATE OR DELETE ON stocktake
FOR EACH ROW EXECUTE FUNCTION prevent_stocktake_changes();

-- Down Migration
DROP TRIGGER stocktake_immutable ON stocktake;
DROP FUNCTION prevent_stocktake_changes();
DROP TABLE stocktake_request;
DROP TABLE stocktake;
