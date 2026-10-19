-- Up Migration
-- Historical payouts are deliberately not assigned to a guessed drawer.
ALTER TABLE cash_movement ADD COLUMN refund_id uuid REFERENCES sale_refund(id);
CREATE UNIQUE INDEX cash_movement_one_refund ON cash_movement(refund_id)
  WHERE refund_id IS NOT NULL;
ALTER TABLE cash_movement ADD CONSTRAINT cash_movement_refund_payout
  CHECK (refund_id IS NULL OR (kind = 'cash_out' AND payment_id IS NULL));

-- Down Migration
-- Dropping populated links would lose the payout reconciliation trail.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cash_movement WHERE refund_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Refund drawer movements exist; preserve their audit links';
  END IF;
END $$;
ALTER TABLE cash_movement DROP CONSTRAINT cash_movement_refund_payout;
DROP INDEX cash_movement_one_refund;
ALTER TABLE cash_movement DROP COLUMN refund_id;
