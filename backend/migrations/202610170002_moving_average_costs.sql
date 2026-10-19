-- Up Migration
CREATE TABLE stock_valuation (
  product_id uuid PRIMARY KEY REFERENCES catalogue_product(id),
  quantity_minor bigint NOT NULL CHECK (quantity_minor >= 0),
  value_minor bigint CHECK (value_minor >= 0),
  CHECK (quantity_minor <> 0 OR value_minor = 0)
);
INSERT INTO stock_valuation(product_id, quantity_minor, value_minor)
SELECT product_id, quantity_minor, CASE WHEN quantity_minor = 0 THEN 0 END FROM inventory_stock;

ALTER TABLE inventory_movement
  ADD COLUMN cost_input_minor bigint CHECK (cost_input_minor >= 0),
  ADD COLUMN sale_line_id uuid REFERENCES sale_line(id),
  ADD COLUMN return_line_id uuid REFERENCES sale_return_line(id);
CREATE UNIQUE INDEX inventory_cost_sale_line ON inventory_movement(sale_line_id) WHERE sale_line_id IS NOT NULL;
CREATE UNIQUE INDEX inventory_cost_return_line ON inventory_movement(return_line_id) WHERE return_line_id IS NOT NULL;

CREATE TABLE stock_cost_entry (
  id uuid PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES catalogue_product(id),
  movement_id uuid UNIQUE REFERENCES inventory_movement(id),
  sale_line_id uuid UNIQUE REFERENCES sale_line(id),
  return_line_id uuid UNIQUE REFERENCES sale_return_line(id),
  quantity_after_minor bigint NOT NULL,
  value_delta_minor bigint,
  value_after_minor bigint CHECK (value_after_minor >= 0),
  actor_id text NOT NULL REFERENCES "user"(id),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER stock_cost_entry_immutable BEFORE UPDATE OR DELETE ON stock_cost_entry
FOR EACH ROW EXECUTE FUNCTION prevent_inventory_movement_changes();

CREATE FUNCTION apply_moving_average_cost() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pool stock_valuation%ROWTYPE;
  previous_quantity bigint := NEW.quantity_after_minor - NEW.delta_minor;
  delta_value bigint;
  next_value bigint;
  original_cost bigint;
  sold_quantity bigint;
  returned_quantity bigint;
BEGIN
  -- Product locking is shared with every stock writer and opening valuation.
  PERFORM id FROM catalogue_product WHERE id = NEW.product_id FOR UPDATE;
  INSERT INTO stock_valuation(product_id, quantity_minor, value_minor)
  VALUES (NEW.product_id, previous_quantity, CASE WHEN previous_quantity = 0 THEN 0 END)
  ON CONFLICT DO NOTHING;
  SELECT * INTO pool FROM stock_valuation WHERE product_id = NEW.product_id FOR UPDATE;
  IF pool.quantity_minor <> previous_quantity THEN
    RAISE EXCEPTION 'Stock valuation quantity mismatch';
  END IF;
  IF NEW.sale_line_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM sale_line WHERE id = NEW.sale_line_id AND product_id = NEW.product_id
      AND quantity_minor = -NEW.delta_minor AND NEW.kind = 'sale'
  ) THEN RAISE EXCEPTION 'Invalid sale cost source'; END IF;

  IF NEW.delta_minor < 0 THEN
    delta_value := -round(pool.value_minor::numeric * (-NEW.delta_minor) / NULLIF(previous_quantity, 0))::bigint;
  ELSIF NEW.return_line_id IS NOT NULL THEN
    SELECT -c.value_delta_minor, sl.quantity_minor,
      (SELECT SUM(rl.quantity_minor) FROM sale_return_line rl JOIN sale_return r ON r.id = rl.return_id
       WHERE rl.sale_line_id = sl.id AND r.status = 'completed')
      INTO original_cost, sold_quantity, returned_quantity
    FROM sale_return_line target JOIN sale_line sl ON sl.id = target.sale_line_id
    LEFT JOIN stock_cost_entry c ON c.sale_line_id = sl.id
    WHERE target.id = NEW.return_line_id AND target.product_id = NEW.product_id
      AND target.quantity_minor = NEW.delta_minor AND NEW.kind = 'return';
    IF NOT FOUND THEN RAISE EXCEPTION 'Invalid return cost source'; END IF;
    delta_value := round(original_cost::numeric * returned_quantity / sold_quantity)::bigint
      - round(original_cost::numeric * (returned_quantity - NEW.delta_minor) / sold_quantity)::bigint;
  ELSIF NEW.cost_input_minor IS NOT NULL THEN
    IF NEW.kind <> 'receive' THEN RAISE EXCEPTION 'Costs must come from a purchase receipt'; END IF;
    delta_value := NEW.cost_input_minor;
  ELSIF NEW.kind IN ('adjustment', 'stocktake') AND previous_quantity > 0 THEN
    delta_value := round(pool.value_minor::numeric * NEW.delta_minor / previous_quantity)::bigint;
  ELSIF NEW.delta_minor = 0 THEN
    delta_value := 0;
  ELSE
    delta_value := NULL;
  END IF;
  next_value := pool.value_minor + delta_value;
  IF NEW.quantity_after_minor = 0 THEN next_value := 0; END IF;
  UPDATE stock_valuation SET quantity_minor = NEW.quantity_after_minor, value_minor = next_value
    WHERE product_id = NEW.product_id;
  INSERT INTO stock_cost_entry(id, product_id, movement_id, sale_line_id, return_line_id,
    quantity_after_minor, value_delta_minor, value_after_minor, actor_id, reason)
  VALUES (NEW.id, NEW.product_id, NEW.id, NEW.sale_line_id, NEW.return_line_id,
    NEW.quantity_after_minor, delta_value, next_value, NEW.actor_id, NEW.reason);
  RETURN NEW;
END $$;
CREATE TRIGGER inventory_moving_average AFTER INSERT ON inventory_movement
FOR EACH ROW EXECUTE FUNCTION apply_moving_average_cost();

-- Down Migration
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM stock_cost_entry) THEN
    RAISE EXCEPTION 'Cost history exists; preserve the valuation audit trail';
  END IF;
END $$;
DROP TRIGGER inventory_moving_average ON inventory_movement;
DROP FUNCTION apply_moving_average_cost();
DROP TABLE stock_cost_entry;
DROP INDEX inventory_cost_return_line;
DROP INDEX inventory_cost_sale_line;
ALTER TABLE inventory_movement DROP COLUMN return_line_id, DROP COLUMN sale_line_id, DROP COLUMN cost_input_minor;
DROP TABLE stock_valuation;
