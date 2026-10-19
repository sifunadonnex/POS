-- Up Migration
ALTER TABLE "user" DROP CONSTRAINT user_role_check;
ALTER TABLE "user" ADD CONSTRAINT user_role_check CHECK (role IN ('manager', 'supervisor', 'cashier'));

CREATE TABLE business_setting (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  expiry_warning_days integer CHECK (expiry_warning_days BETWEEN 0 AND 365),
  revision integer NOT NULL DEFAULT 1
);
INSERT INTO business_setting (id) VALUES (true);
CREATE TABLE business_branch (
  id uuid PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX business_branch_name ON business_branch (lower(name));
CREATE TABLE business_department (
  id uuid PRIMARY KEY, branch_id uuid NOT NULL REFERENCES business_branch(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true, UNIQUE(branch_id, name)
);
CREATE TABLE business_till (
  id uuid PRIMARY KEY, department_id uuid NOT NULL REFERENCES business_department(id),
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 100),
  active boolean NOT NULL DEFAULT true, UNIQUE(department_id, name)
);
CREATE TABLE staff_department_access (
  user_id text NOT NULL REFERENCES "user"(id),
  department_id uuid NOT NULL REFERENCES business_department(id),
  home boolean NOT NULL DEFAULT false, expires_at timestamptz,
  PRIMARY KEY(user_id, department_id), CHECK (NOT home OR expires_at IS NULL)
);
CREATE UNIQUE INDEX staff_one_home_department ON staff_department_access(user_id) WHERE home;
-- Existing inventory/history stays unassigned until explicitly reviewed by a manager.
ALTER TABLE catalogue_product ADD COLUMN department_id uuid REFERENCES business_department(id);
ALTER TABLE catalogue_product ADD COLUMN expiry_date date;
ALTER TABLE cash_shift ADD COLUMN department_id uuid REFERENCES business_department(id);
ALTER TABLE cash_shift ADD COLUMN till_id uuid REFERENCES business_till(id);
CREATE UNIQUE INDEX cash_shift_one_open_till ON cash_shift(till_id) WHERE status = 'open' AND till_id IS NOT NULL;
ALTER TABLE sale ADD COLUMN department_id uuid REFERENCES business_department(id);
ALTER TABLE sale ADD COLUMN till_id uuid REFERENCES business_till(id);
ALTER TABLE purchase_receipt ADD COLUMN department_id uuid REFERENCES business_department(id);
ALTER TABLE suspended_order ADD COLUMN department_id uuid REFERENCES business_department(id);
CREATE INDEX catalogue_department ON catalogue_product(department_id);
CREATE INDEX sale_department ON sale(department_id, created_at);
CREATE INDEX catalogue_expiry ON catalogue_product(expiry_date) WHERE active AND expiry_date IS NOT NULL;

-- Down Migration
-- Refuse rollback while supervisor accounts exist: do not silently demote staff.
ALTER TABLE "user" DROP CONSTRAINT user_role_check;
ALTER TABLE "user" ADD CONSTRAINT user_role_check CHECK (role IN ('manager', 'cashier'));
DROP INDEX catalogue_expiry, sale_department, catalogue_department;
ALTER TABLE suspended_order DROP COLUMN department_id;
ALTER TABLE purchase_receipt DROP COLUMN department_id;
ALTER TABLE sale DROP COLUMN till_id, DROP COLUMN department_id;
DROP INDEX cash_shift_one_open_till;
ALTER TABLE cash_shift DROP COLUMN till_id, DROP COLUMN department_id;
ALTER TABLE catalogue_product DROP COLUMN expiry_date, DROP COLUMN department_id;
DROP TABLE staff_department_access, business_till, business_department, business_branch, business_setting;
