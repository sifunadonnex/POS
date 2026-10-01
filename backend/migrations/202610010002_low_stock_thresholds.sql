-- Up Migration
ALTER TABLE catalogue_product
ADD COLUMN low_stock_threshold_minor bigint
CHECK (
  low_stock_threshold_minor IS NULL
  OR low_stock_threshold_minor BETWEEN 0 AND 999999999999
);

COMMENT ON COLUMN catalogue_product.low_stock_threshold_minor IS
  'Optional alert threshold in the product stock unit: whole units for each/pack, thousandths for kg/l.';

CREATE INDEX catalogue_product_low_stock_threshold
ON catalogue_product (id)
WHERE active AND low_stock_threshold_minor IS NOT NULL;

-- Down Migration
DROP INDEX catalogue_product_low_stock_threshold;
ALTER TABLE catalogue_product DROP COLUMN low_stock_threshold_minor;
