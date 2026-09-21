-- Up Migration
ALTER TABLE sale_payment
  ADD COLUMN shift_id uuid REFERENCES cash_shift(id);

CREATE INDEX sale_payment_shift ON sale_payment (shift_id, created_at DESC);

ALTER TABLE cash_movement
  ADD COLUMN payment_id uuid REFERENCES sale_payment(id);

CREATE UNIQUE INDEX cash_movement_one_payment
  ON cash_movement (payment_id)
  WHERE payment_id IS NOT NULL;

-- Down Migration
DROP INDEX cash_movement_one_payment;
ALTER TABLE cash_movement DROP COLUMN payment_id;
DROP INDEX sale_payment_shift;
ALTER TABLE sale_payment DROP COLUMN shift_id;
