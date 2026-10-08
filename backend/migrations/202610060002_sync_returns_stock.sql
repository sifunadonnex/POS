-- Up Migration
ALTER TABLE sync_outbox DROP CONSTRAINT sync_outbox_event_type_check;
ALTER TABLE sync_outbox ADD CONSTRAINT sync_outbox_event_type_check
  CHECK (event_type IN ('cash_sale.completed', 'sale_refund.paid',
    'stock_movement.recorded'));
ALTER TABLE sync_inbox DROP CONSTRAINT sync_inbox_event_type_check;
ALTER TABLE sync_inbox ADD CONSTRAINT sync_inbox_event_type_check
  CHECK (event_type IN ('cash_sale.completed', 'sale_refund.paid',
    'stock_movement.recorded'));

-- Every edge stock writer already commits an immutable movement. The trigger
-- writes its event in that same transaction, including bootstrap opening stock.
CREATE FUNCTION enqueue_edge_stock_movement() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE edge_store uuid;
DECLARE product_row record;
BEGIN
  SELECT store_id INTO edge_store FROM store_bootstrap_state
    WHERE singleton AND runtime_mode = 'edge';
  IF edge_store IS NULL THEN RETURN NEW; END IF;
  SELECT name, sku, unit INTO STRICT product_row
    FROM catalogue_product WHERE id = NEW.product_id;
  INSERT INTO sync_outbox
    (id, store_id, event_type, aggregate_id, schema_version, payload)
  VALUES (NEW.id, edge_store, 'stock_movement.recorded', NEW.id, 1,
    jsonb_build_object(
      'eventId', NEW.id, 'storeId', edge_store,
      'eventType', 'stock_movement.recorded', 'schemaVersion', 1,
      'movementId', NEW.id, 'productId', NEW.product_id,
      'productName', product_row.name, 'sku', product_row.sku,
      'unit', product_row.unit, 'kind', NEW.kind,
      'deltaMinor', NEW.delta_minor,
      'quantityAfterMinor', NEW.quantity_after_minor,
      'actorId', NEW.actor_id, 'reason', NEW.reason,
      'occurredAt', NEW.created_at));
  RETURN NEW;
END;
$$;
CREATE TRIGGER edge_stock_movement_outbox
  AFTER INSERT ON inventory_movement FOR EACH ROW
  EXECUTE FUNCTION enqueue_edge_stock_movement();

CREATE FUNCTION enqueue_edge_paid_refund() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE edge_store uuid;
DECLARE cashier record;
BEGIN
  IF NEW.status <> 'paid' THEN RETURN NEW; END IF;
  SELECT store_id INTO edge_store FROM store_bootstrap_state
    WHERE singleton AND runtime_mode = 'edge';
  IF edge_store IS NULL THEN RETURN NEW; END IF;
  SELECT s.actor_id, u.name INTO STRICT cashier
    FROM sale s JOIN "user" u ON u.id = s.actor_id WHERE s.id = NEW.sale_id;
  INSERT INTO sync_outbox
    (id, store_id, event_type, aggregate_id, schema_version, payload)
  VALUES (NEW.id, edge_store, 'sale_refund.paid', NEW.id, 1,
    jsonb_build_object(
      'eventId', NEW.id, 'storeId', edge_store,
      'eventType', 'sale_refund.paid', 'schemaVersion', 1,
      'refundId', NEW.id, 'saleId', NEW.sale_id,
      'returnId', NEW.return_id, 'cashierId', cashier.actor_id,
      'cashierName', cashier.name, 'amountMinor', NEW.amount_minor,
      'occurredAt', NEW.created_at));
  RETURN NEW;
END;
$$;
CREATE TRIGGER edge_paid_refund_outbox
  AFTER INSERT ON sale_refund FOR EACH ROW
  EXECUTE FUNCTION enqueue_edge_paid_refund();

CREATE TABLE sync_refund_projection (
  event_id uuid PRIMARY KEY REFERENCES sync_inbox(id),
  store_id uuid NOT NULL,
  refund_id uuid NOT NULL,
  sale_id uuid NOT NULL,
  return_id uuid NOT NULL,
  cashier_id text NOT NULL CHECK (length(cashier_id) BETWEEN 1 AND 255),
  cashier_name text NOT NULL CHECK (length(cashier_name) BETWEEN 1 AND 160),
  amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
  occurred_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, refund_id)
);
CREATE INDEX sync_refund_projection_store_occurred
  ON sync_refund_projection(store_id, occurred_at DESC, event_id);
CREATE INDEX sync_refund_projection_store_cashier_occurred
  ON sync_refund_projection(store_id, cashier_id, occurred_at DESC);
CREATE TRIGGER sync_refund_projection_append_only
  BEFORE UPDATE OR DELETE ON sync_refund_projection
  FOR EACH ROW EXECUTE FUNCTION prevent_sync_projection_changes();

CREATE TABLE sync_stock_movement_projection (
  event_id uuid PRIMARY KEY REFERENCES sync_inbox(id),
  store_id uuid NOT NULL,
  movement_id uuid NOT NULL,
  product_id uuid NOT NULL,
  product_name text NOT NULL CHECK (length(product_name) BETWEEN 1 AND 160),
  sku text NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  unit text NOT NULL CHECK (unit IN ('each', 'pack', 'kg', 'l')),
  kind text NOT NULL CHECK (kind IN
    ('opening', 'receive', 'adjustment', 'sale', 'return', 'stocktake')),
  delta_minor bigint NOT NULL CHECK (delta_minor <> 0),
  quantity_after_minor bigint NOT NULL CHECK (quantity_after_minor >= 0),
  actor_id text NOT NULL CHECK (length(actor_id) BETWEEN 1 AND 255),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  occurred_at timestamptz NOT NULL,
  projected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, movement_id)
);
CREATE INDEX sync_stock_movement_projection_store_product
  ON sync_stock_movement_projection(store_id, product_id, occurred_at DESC);
CREATE TRIGGER sync_stock_movement_projection_append_only
  BEFORE UPDATE OR DELETE ON sync_stock_movement_projection
  FOR EACH ROW EXECUTE FUNCTION prevent_sync_projection_changes();

-- Down Migration
DROP TRIGGER sync_stock_movement_projection_append_only ON sync_stock_movement_projection;
DROP TRIGGER sync_refund_projection_append_only ON sync_refund_projection;
DROP TABLE sync_stock_movement_projection;
DROP TABLE sync_refund_projection;
DROP TRIGGER edge_paid_refund_outbox ON sale_refund;
DROP FUNCTION enqueue_edge_paid_refund();
DROP TRIGGER edge_stock_movement_outbox ON inventory_movement;
DROP FUNCTION enqueue_edge_stock_movement();
ALTER TABLE sync_inbox DROP CONSTRAINT sync_inbox_event_type_check;
ALTER TABLE sync_inbox ADD CONSTRAINT sync_inbox_event_type_check
  CHECK (event_type = 'cash_sale.completed');
ALTER TABLE sync_outbox DROP CONSTRAINT sync_outbox_event_type_check;
ALTER TABLE sync_outbox ADD CONSTRAINT sync_outbox_event_type_check
  CHECK (event_type = 'cash_sale.completed');
