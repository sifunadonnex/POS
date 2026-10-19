-- Up Migration
CREATE TABLE register_basket (
  user_id text NOT NULL REFERENCES "user"(id),
  department_id uuid NOT NULL REFERENCES business_department(id),
  revision integer NOT NULL DEFAULT 1,
  lines jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(lines) = 'array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, department_id)
);
-- Down Migration
DROP TABLE register_basket;
