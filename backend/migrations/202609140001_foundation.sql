-- Up Migration
CREATE TABLE app_metadata (
  key text PRIMARY KEY,
  value text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO app_metadata (key, value) VALUES ('application', 'pay-and-go');

-- Down Migration
DROP TABLE app_metadata;
