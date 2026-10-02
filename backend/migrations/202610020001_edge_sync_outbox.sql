-- Up Migration
CREATE TABLE sync_outbox (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('cash_sale.completed')),
  aggregate_id uuid NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  last_attempt_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 500),
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, event_type, aggregate_id),
  CHECK (delivered_at IS NULL OR delivered_at >= created_at)
);

CREATE INDEX sync_outbox_pending
  ON sync_outbox (created_at, id)
  WHERE delivered_at IS NULL;

-- Down Migration
DROP TABLE sync_outbox;
