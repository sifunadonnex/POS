-- Up Migration
CREATE TABLE catalogue_category (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0)
);
CREATE UNIQUE INDEX catalogue_category_name ON catalogue_category (lower(name));

CREATE TABLE catalogue_product (
  id uuid PRIMARY KEY,
  sku text NOT NULL UNIQUE CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  category_id uuid REFERENCES catalogue_category(id),
  unit text NOT NULL CHECK (unit IN ('each', 'pack', 'kg', 'l')),
  price_minor bigint NOT NULL CHECK (price_minor BETWEEN 0 AND 999999999),
  tax_code text CHECK (length(tax_code) BETWEEN 1 AND 40),
  active boolean NOT NULL DEFAULT true,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX catalogue_product_category ON catalogue_product (category_id);
CREATE INDEX catalogue_product_name ON catalogue_product (lower(name), id);
CREATE TABLE catalogue_barcode (
  code text PRIMARY KEY CHECK (code ~ '^[A-Za-z0-9._-]{1,64}$'),
  product_id uuid NOT NULL REFERENCES catalogue_product(id)
);
CREATE INDEX catalogue_barcode_product ON catalogue_barcode (product_id);

CREATE TABLE catalogue_history (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('product', 'category')),
  entity_id uuid NOT NULL,
  revision integer NOT NULL CHECK (revision > 0),
  actor_id text NOT NULL REFERENCES "user"(id),
  reason text NOT NULL CHECK (length(reason) BETWEEN 3 AND 200),
  snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, revision)
);
CREATE FUNCTION prevent_catalogue_history_changes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Catalogue history is append-only';
END;
$$;
CREATE TRIGGER catalogue_history_immutable BEFORE UPDATE OR DELETE ON catalogue_history
FOR EACH ROW EXECUTE FUNCTION prevent_catalogue_history_changes();

-- Receipts for retried catalogue writes. No credentials or request bodies are stored.
CREATE TABLE catalogue_request (
  id uuid PRIMARY KEY,
  actor_id text NOT NULL REFERENCES "user"(id),
  fingerprint text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Down Migration
-- Disposable test rollback only: permanently removes catalogue and its history.
DROP TABLE catalogue_request;
DROP TABLE catalogue_history;
DROP FUNCTION prevent_catalogue_history_changes();
DROP TABLE catalogue_barcode;
DROP TABLE catalogue_product;
DROP TABLE catalogue_category;
