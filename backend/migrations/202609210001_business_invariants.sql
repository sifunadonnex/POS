-- Up Migration
-- Stocktake is an inventory movement and stock must never be negative.
ALTER TABLE inventory_movement
  DROP CONSTRAINT inventory_movement_kind_check,
  ADD CONSTRAINT inventory_movement_kind_check
    CHECK (kind IN ('opening', 'receive', 'adjustment', 'sale', 'return', 'stocktake'));

ALTER TABLE inventory_stock
  DROP CONSTRAINT inventory_stock_quantity_minor_check,
  ADD CONSTRAINT inventory_stock_quantity_minor_check CHECK (quantity_minor >= 0);

CREATE UNIQUE INDEX cash_shift_one_open_per_cashier
  ON cash_shift (cashier_id) WHERE status = 'open';

CREATE OR REPLACE FUNCTION prevent_shift_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'cash_shift'
     AND OLD.status = 'open'
     AND NEW.status = 'closed'
     AND NEW.cashier_id = OLD.cashier_id
     AND NEW.opening_cash_minor = OLD.opening_cash_minor
     AND NEW.opened_at = OLD.opened_at
     AND NEW.created_at = OLD.created_at
     AND NEW.closing_cash_minor IS NOT NULL
     AND NEW.variance_minor IS NOT NULL
     AND NEW.closed_at IS NOT NULL THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Shift history is append-only';
END;
$$;

-- Down Migration
DROP INDEX cash_shift_one_open_per_cashier;

CREATE OR REPLACE FUNCTION prevent_shift_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Shift history is append-only';
END;
$$;

ALTER TABLE inventory_stock
  DROP CONSTRAINT inventory_stock_quantity_minor_check,
  ADD CONSTRAINT inventory_stock_quantity_minor_check
    CHECK (quantity_minor >= -999999999999);

ALTER TABLE inventory_movement
  DROP CONSTRAINT inventory_movement_kind_check,
  ADD CONSTRAINT inventory_movement_kind_check
    CHECK (kind IN ('opening', 'receive', 'adjustment', 'sale', 'return'));
