-- Up Migration
-- A completed cash payment records the cash handed over separately from the
-- settled sale amount. Existing payment history predates tender capture, so
-- its nullable value is treated as an exact tender by reads.
ALTER TABLE sale_payment
  ADD COLUMN tendered_minor bigint CHECK (tendered_minor IS NULL OR tendered_minor >= amount_minor);

-- Down Migration
ALTER TABLE sale_payment DROP COLUMN tendered_minor;
