-- Up Migration
-- A product identity owns one department balance; codes may repeat elsewhere.
ALTER TABLE catalogue_product DROP CONSTRAINT catalogue_product_sku_key;
CREATE UNIQUE INDEX catalogue_department_sku ON catalogue_product(department_id, sku) WHERE department_id IS NOT NULL;
CREATE UNIQUE INDEX catalogue_legacy_sku ON catalogue_product(sku) WHERE department_id IS NULL;

ALTER TABLE catalogue_barcode ADD COLUMN department_id uuid REFERENCES business_department(id);
UPDATE catalogue_barcode b SET department_id = p.department_id FROM catalogue_product p
WHERE p.id = b.product_id AND b.department_id IS DISTINCT FROM p.department_id;
ALTER TABLE catalogue_barcode DROP CONSTRAINT catalogue_barcode_pkey;
ALTER TABLE catalogue_barcode ADD PRIMARY KEY(product_id, code);
CREATE UNIQUE INDEX catalogue_department_barcode ON catalogue_barcode(department_id, code) WHERE department_id IS NOT NULL;
CREATE UNIQUE INDEX catalogue_legacy_barcode ON catalogue_barcode(code) WHERE department_id IS NULL;

CREATE FUNCTION derive_barcode_department() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  SELECT department_id INTO NEW.department_id FROM catalogue_product WHERE id = NEW.product_id FOR SHARE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalogue_barcode_department BEFORE INSERT OR UPDATE ON catalogue_barcode
FOR EACH ROW EXECUTE FUNCTION derive_barcode_department();

CREATE FUNCTION keep_product_department() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.department_id IS NOT NULL AND OLD.department_id IS DISTINCT FROM NEW.department_id THEN
    RAISE EXCEPTION 'Assigned stock cannot be moved by editing a product';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalogue_product_department BEFORE UPDATE OF department_id ON catalogue_product
FOR EACH ROW EXECUTE FUNCTION keep_product_department();

CREATE FUNCTION sync_barcode_department() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE catalogue_barcode SET department_id = NEW.department_id WHERE product_id = NEW.id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER catalogue_product_barcode_department AFTER UPDATE OF department_id ON catalogue_product
FOR EACH ROW WHEN (OLD.department_id IS DISTINCT FROM NEW.department_id) EXECUTE FUNCTION sync_barcode_department();

-- Down Migration
-- Duplicate codes across departments make this rollback fail atomically; never delete products to force it.
DROP TRIGGER catalogue_product_barcode_department ON catalogue_product;
DROP FUNCTION sync_barcode_department();
DROP TRIGGER catalogue_product_department ON catalogue_product;
DROP FUNCTION keep_product_department();
DROP TRIGGER catalogue_barcode_department ON catalogue_barcode;
DROP FUNCTION derive_barcode_department();
DROP INDEX catalogue_department_barcode, catalogue_legacy_barcode;
ALTER TABLE catalogue_barcode DROP CONSTRAINT catalogue_barcode_pkey;
ALTER TABLE catalogue_barcode ADD PRIMARY KEY(code);
ALTER TABLE catalogue_barcode DROP COLUMN department_id;
DROP INDEX catalogue_department_sku, catalogue_legacy_sku;
ALTER TABLE catalogue_product ADD CONSTRAINT catalogue_product_sku_key UNIQUE(sku);
