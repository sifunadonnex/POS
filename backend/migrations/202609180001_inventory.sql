-- Up Migration
CREATE TABLE inventory_stock (
  product_id uuid PRIMARY KEY REFERENCES catalogue_product(id),
  unit text NOT NULL CHECK (unit IN ('each', 'pack', 'kg', 'l')),
  quantity_minor bigint NOT NULL DEFAULT 0 CHECK (quantity_minor >= -999999999999),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE inventory_movement (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES catalogue_product(id),
  kind text NOT NULL CHECK (kind IN ('opening', 'receive', 'adjustment', 'sale', 'return')),
  delta_minor bigint NOT NULL CHECK (delta_minor <> 0),
  quantity_after_minor bigint NOT NULL CHECK (quantity_after_minor >= 0),
  actor_id text NOT NULL REFERENCES "user"(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movement_product ON inventory_movement (product_id, created_at DESC);

CREATE TABLE inventory_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE FUNCTION prevent_inventory_movement_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Inventory movement history is append-only';
END;
$$;
CREATE TRIGGER inventory_movement_immutable BEFORE UPDATE OR DELETE ON inventory_movement
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_changes();

-- Down Migration
DROP TABLE inventory_request;
DROP TRIGGER inventory_movement_immutable ON inventory_movement;
DROP FUNCTION prevent_inventory_movement_changes();
DROP TABLE inventory_movement;
DROP TABLE inventory_stock;
