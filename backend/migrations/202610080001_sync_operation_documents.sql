-- Up Migration
ALTER TABLE sync_outbox DROP CONSTRAINT sync_outbox_event_type_check;
ALTER TABLE sync_outbox ADD CONSTRAINT sync_outbox_event_type_check CHECK (event_type IN
  ('cash_sale.completed', 'sale_refund.paid', 'stock_movement.recorded',
   'purchase_receipt.received', 'purchase_return.returned', 'stocktake.counted'));
ALTER TABLE sync_inbox DROP CONSTRAINT sync_inbox_event_type_check;
ALTER TABLE sync_inbox ADD CONSTRAINT sync_inbox_event_type_check CHECK (event_type IN
  ('cash_sale.completed', 'sale_refund.paid', 'stock_movement.recorded',
   'purchase_receipt.received', 'purchase_return.returned', 'stocktake.counted'));

-- A deferred header trigger sees every line before commit. Its outbox insert
-- rolls back with the source document and the associated stock movements.
CREATE FUNCTION enqueue_edge_operation_document() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE edge_store uuid;
DECLARE event_name text;
DECLARE snapshot jsonb;
BEGIN
  SELECT store_id INTO edge_store FROM store_bootstrap_state
    WHERE singleton AND runtime_mode = 'edge';
  IF edge_store IS NULL THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'purchase_receipt' THEN
    IF NEW.status <> 'received' THEN RETURN NEW; END IF;
    event_name := 'purchase_receipt.received';
    SELECT jsonb_build_object(
      'documentId', NEW.id, 'supplierId', NEW.supplier_id,
      'supplierName', supplier.name, 'actorId', NEW.actor_id,
      'actorName', actor.name, 'reason', NEW.reason,
      'totalMinor', NEW.total_minor, 'lines',
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'lineId', line.id, 'productId', line.product_id,
        'productName', product.name, 'sku', product.sku, 'unit', product.unit,
        'quantityMinor', line.quantity_minor, 'unitCostMinor', line.unit_cost_minor,
        'lineTotalMinor', line.line_total_minor) ORDER BY line.id)
        FROM purchase_receipt_line line
        JOIN catalogue_product product ON product.id = line.product_id
        WHERE line.receipt_id = NEW.id), '[]'::jsonb))
      INTO STRICT snapshot FROM supplier JOIN "user" actor ON actor.id = NEW.actor_id
      WHERE supplier.id = NEW.supplier_id;
  ELSIF TG_TABLE_NAME = 'purchase_return' THEN
    IF NEW.status <> 'returned' THEN RETURN NEW; END IF;
    event_name := 'purchase_return.returned';
    SELECT jsonb_build_object(
      'documentId', NEW.id, 'receiptId', NEW.receipt_id,
      'supplierId', receipt.supplier_id, 'supplierName', supplier.name,
      'actorId', NEW.actor_id, 'actorName', actor.name,
      'reason', NEW.reason, 'totalMinor', NEW.total_minor, 'lines',
      COALESCE((SELECT jsonb_agg(jsonb_build_object(
        'lineId', line.id, 'receiptLineId', line.receipt_line_id,
        'productId', line.product_id, 'productName', product.name,
        'sku', product.sku, 'unit', product.unit,
        'quantityMinor', line.quantity_minor, 'unitCostMinor', line.unit_cost_minor,
        'lineTotalMinor', line.line_total_minor) ORDER BY line.id)
        FROM purchase_return_line line
        JOIN catalogue_product product ON product.id = line.product_id
        WHERE line.return_id = NEW.id), '[]'::jsonb))
      INTO STRICT snapshot FROM purchase_receipt receipt
      JOIN supplier ON supplier.id = receipt.supplier_id
      JOIN "user" actor ON actor.id = NEW.actor_id
      WHERE receipt.id = NEW.receipt_id;
  ELSE
    event_name := 'stocktake.counted';
    IF NEW.counted_quantity_minor - NEW.previous_quantity_minor <> NEW.delta_minor THEN
      RAISE EXCEPTION 'Stocktake delta does not match count';
    END IF;
    SELECT jsonb_build_object(
      'documentId', NEW.id, 'productId', NEW.product_id,
      'productName', product.name, 'sku', product.sku, 'unit', product.unit,
      'actorId', NEW.actor_id, 'actorName', actor.name, 'reason', NEW.reason,
      'previousQuantityMinor', NEW.previous_quantity_minor,
      'countedQuantityMinor', NEW.counted_quantity_minor,
      'deltaMinor', NEW.delta_minor)
      INTO STRICT snapshot FROM catalogue_product product
      JOIN "user" actor ON actor.id = NEW.actor_id
      WHERE product.id = NEW.product_id;
  END IF;
  IF event_name <> 'stocktake.counted' THEN
    IF jsonb_array_length(snapshot->'lines') NOT BETWEEN 1 AND 200 OR
      (SELECT COALESCE(SUM((line->>'lineTotalMinor')::bigint), 0)
       FROM jsonb_array_elements(snapshot->'lines') line) <> NEW.total_minor
    THEN
      RAISE EXCEPTION 'Purchase document lines do not match total';
    END IF;
  END IF;
  INSERT INTO sync_outbox
    (id, store_id, event_type, aggregate_id, schema_version, payload)
  VALUES (NEW.id, edge_store, event_name, NEW.id, 1,
    snapshot || jsonb_build_object('eventId', NEW.id, 'storeId', edge_store,
      'eventType', event_name, 'schemaVersion', 1,
      'occurredAt', NEW.created_at));
  RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER edge_purchase_receipt_outbox
  AFTER INSERT ON purchase_receipt DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enqueue_edge_operation_document();
CREATE CONSTRAINT TRIGGER edge_purchase_return_outbox
  AFTER INSERT ON purchase_return DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION enqueue_edge_operation_document();
CREATE TRIGGER edge_stocktake_document_outbox
  AFTER INSERT ON stocktake FOR EACH ROW
  EXECUTE FUNCTION enqueue_edge_operation_document();

CREATE TABLE sync_operation_document_projection (
  event_id uuid PRIMARY KEY REFERENCES sync_inbox(id),
  store_id uuid NOT NULL,
  document_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN
    ('purchase_receipt.received', 'purchase_return.returned', 'stocktake.counted')),
  occurred_at timestamptz NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  reason text NOT NULL,
  supplier_id uuid,
  supplier_name text,
  receipt_id uuid,
  total_minor bigint,
  product_id uuid,
  product_name text,
  sku text,
  unit text,
  previous_quantity_minor bigint,
  counted_quantity_minor bigint,
  delta_minor bigint,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array'),
  projected_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, event_type, document_id),
  CHECK ((event_type = 'stocktake.counted' AND product_id IS NOT NULL
      AND previous_quantity_minor IS NOT NULL AND counted_quantity_minor IS NOT NULL
      AND delta_minor IS NOT NULL AND supplier_id IS NULL AND total_minor IS NULL)
    OR (event_type <> 'stocktake.counted' AND supplier_id IS NOT NULL
      AND supplier_name IS NOT NULL AND total_minor IS NOT NULL
      AND product_id IS NULL))
);
CREATE INDEX sync_operation_document_store_date
  ON sync_operation_document_projection (store_id, occurred_at DESC, event_id);
CREATE TRIGGER sync_operation_document_append_only
  BEFORE UPDATE OR DELETE ON sync_operation_document_projection
  FOR EACH ROW EXECUTE FUNCTION prevent_sync_projection_changes();

-- A count with no change still has a meaningful document and stock event.
ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_delta_minor_check;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_delta_minor_check
  CHECK (delta_minor <> 0 OR kind = 'stocktake');
ALTER TABLE sync_stock_movement_projection
  DROP CONSTRAINT sync_stock_movement_projection_delta_minor_check;
ALTER TABLE sync_stock_movement_projection ADD CONSTRAINT
  sync_stock_movement_projection_delta_minor_check
  CHECK (delta_minor <> 0 OR kind = 'stocktake');

-- Down Migration
DROP TRIGGER sync_operation_document_append_only ON sync_operation_document_projection;
DROP TABLE sync_operation_document_projection;
DROP TRIGGER edge_stocktake_document_outbox ON stocktake;
DROP TRIGGER edge_purchase_return_outbox ON purchase_return;
DROP TRIGGER edge_purchase_receipt_outbox ON purchase_receipt;
DROP FUNCTION enqueue_edge_operation_document();
ALTER TABLE inventory_movement DROP CONSTRAINT inventory_movement_delta_minor_check;
ALTER TABLE inventory_movement ADD CONSTRAINT inventory_movement_delta_minor_check
  CHECK (delta_minor <> 0);
ALTER TABLE sync_stock_movement_projection
  DROP CONSTRAINT sync_stock_movement_projection_delta_minor_check;
ALTER TABLE sync_stock_movement_projection ADD CONSTRAINT
  sync_stock_movement_projection_delta_minor_check CHECK (delta_minor <> 0);
ALTER TABLE sync_inbox DROP CONSTRAINT sync_inbox_event_type_check;
ALTER TABLE sync_inbox ADD CONSTRAINT sync_inbox_event_type_check CHECK (event_type IN
  ('cash_sale.completed', 'sale_refund.paid', 'stock_movement.recorded'));
ALTER TABLE sync_outbox DROP CONSTRAINT sync_outbox_event_type_check;
ALTER TABLE sync_outbox ADD CONSTRAINT sync_outbox_event_type_check CHECK (event_type IN
  ('cash_sale.completed', 'sale_refund.paid', 'stock_movement.recorded'));
