-- Up Migration
ALTER TABLE sync_outbox
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE sync_inbox (
  id uuid PRIMARY KEY,
  store_id uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('cash_sale.completed')),
  aggregate_id uuid NOT NULL,
  schema_version integer NOT NULL CHECK (schema_version = 1),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (store_id, event_type, aggregate_id)
);

CREATE INDEX sync_inbox_store_received
  ON sync_inbox (store_id, received_at DESC, id);

-- Down Migration
DROP TABLE sync_inbox;
ALTER TABLE sync_outbox DROP COLUMN next_attempt_at;
