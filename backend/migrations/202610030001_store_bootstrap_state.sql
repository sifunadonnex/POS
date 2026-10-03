-- Up Migration
-- One store only until branch-scoped operational records exist.
CREATE TABLE store_bootstrap_state (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  store_id uuid NOT NULL UNIQUE,
  runtime_mode text NOT NULL CHECK (runtime_mode IN ('hosted', 'edge')),
  checkout_authority text NOT NULL CHECK (checkout_authority IN ('hosted', 'local')),
  generation integer NOT NULL DEFAULT 1 CHECK (generation > 0),
  configuration_version bigint NOT NULL DEFAULT 0 CHECK (configuration_version >= 0),
  configuration_digest text CHECK (configuration_digest IS NULL OR configuration_digest ~ '^[0-9a-f]{64}$'),
  cutover_request_id uuid UNIQUE,
  cutover_at timestamptz,
  last_fence_request_id uuid UNIQUE,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((runtime_mode = 'hosted' AND checkout_authority IN ('hosted', 'local'))
    OR (runtime_mode = 'edge' AND checkout_authority = 'local')),
  CHECK ((cutover_at IS NULL AND cutover_request_id IS NULL)
    OR (cutover_at IS NOT NULL AND cutover_request_id IS NOT NULL))
);

CREATE FUNCTION protect_store_bootstrap_state() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Store authority state cannot be deleted';
  END IF;
  IF NEW.store_id IS DISTINCT FROM OLD.store_id
    OR NEW.runtime_mode IS DISTINCT FROM OLD.runtime_mode
    OR (OLD.checkout_authority = 'local' AND NEW.checkout_authority <> 'local')
    OR NEW.generation < OLD.generation
    OR NEW.generation > OLD.generation + 1
    OR (NEW.generation = OLD.generation
      AND NEW.last_fence_request_id IS DISTINCT FROM OLD.last_fence_request_id)
    OR (NEW.generation = OLD.generation + 1
      AND NEW.last_fence_request_id IS NULL)
    OR NEW.configuration_version < OLD.configuration_version
    OR NEW.configuration_version > OLD.configuration_version + 1
    OR (NEW.configuration_version = OLD.configuration_version + 1
      AND NEW.configuration_digest IS NULL)
    OR (NEW.configuration_version = OLD.configuration_version
      AND NEW.configuration_digest IS DISTINCT FROM OLD.configuration_digest) THEN
    RAISE EXCEPTION 'Store authority state cannot move backwards or change identity';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER store_bootstrap_state_protected
  BEFORE UPDATE OR DELETE ON store_bootstrap_state
  FOR EACH ROW EXECUTE FUNCTION protect_store_bootstrap_state();

-- A hosted cutover locks the same row. Existing writers holding this share lock
-- finish first; later writers observe the new authority before any mutation.
CREATE FUNCTION enforce_hosted_store_authority() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE current_authority text;
BEGIN
  SELECT checkout_authority INTO current_authority
    FROM store_bootstrap_state
    WHERE singleton AND runtime_mode = 'hosted' FOR SHARE;
  IF current_authority = 'local' THEN
    RAISE EXCEPTION 'Store checkout and stock are local after cutover'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

-- These are the hosted operational write roots. Reporting sync tables are
-- deliberately excluded. Reads and pre-cutover writes remain available.
CREATE TRIGGER hosted_sale_authority BEFORE INSERT ON sale
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_sale_payment_authority BEFORE INSERT ON sale_payment
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_inventory_stock_authority BEFORE INSERT OR UPDATE ON inventory_stock
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_inventory_movement_authority BEFORE INSERT ON inventory_movement
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_cash_shift_authority BEFORE INSERT OR UPDATE ON cash_shift
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_cash_movement_authority BEFORE INSERT ON cash_movement
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_return_authority BEFORE INSERT ON sale_return
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_purchase_receipt_authority BEFORE INSERT ON purchase_receipt
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_purchase_return_authority BEFORE INSERT ON purchase_return
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_stocktake_authority BEFORE INSERT ON stocktake
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_payment_attempt_authority BEFORE INSERT OR UPDATE ON payment_attempt
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();
CREATE TRIGGER hosted_suspended_order_authority BEFORE INSERT OR UPDATE ON suspended_order
  FOR EACH ROW EXECUTE FUNCTION enforce_hosted_store_authority();

-- Down Migration
DROP TRIGGER hosted_suspended_order_authority ON suspended_order;
DROP TRIGGER hosted_payment_attempt_authority ON payment_attempt;
DROP TRIGGER hosted_stocktake_authority ON stocktake;
DROP TRIGGER hosted_purchase_return_authority ON purchase_return;
DROP TRIGGER hosted_purchase_receipt_authority ON purchase_receipt;
DROP TRIGGER hosted_return_authority ON sale_return;
DROP TRIGGER hosted_cash_movement_authority ON cash_movement;
DROP TRIGGER hosted_cash_shift_authority ON cash_shift;
DROP TRIGGER hosted_inventory_movement_authority ON inventory_movement;
DROP TRIGGER hosted_inventory_stock_authority ON inventory_stock;
DROP TRIGGER hosted_sale_payment_authority ON sale_payment;
DROP TRIGGER hosted_sale_authority ON sale;
DROP FUNCTION enforce_hosted_store_authority();
DROP TRIGGER store_bootstrap_state_protected ON store_bootstrap_state;
DROP FUNCTION protect_store_bootstrap_state();
DROP TABLE store_bootstrap_state;
