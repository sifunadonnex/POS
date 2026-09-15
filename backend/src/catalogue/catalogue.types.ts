import type { SaleUnit } from './catalogue.input.js';

export type Category = { id: string; name: string; revision: number };
export type Product = {
  id: string;
  sku: string;
  name: string;
  categoryId: string | null;
  categoryName: string | null;
  unit: SaleUnit;
  priceMinor: string;
  taxCode: string | null;
  active: boolean;
  revision: number;
  barcodes: string[];
};
export const productColumns = `p.id, p.sku, p.name, p.category_id AS "categoryId", c.name AS "categoryName",
  p.unit, p.price_minor::text AS "priceMinor", p.tax_code AS "taxCode", p.active, p.revision,
  ARRAY(SELECT b.code FROM catalogue_barcode b WHERE b.product_id = p.id ORDER BY b.code) AS barcodes`;
export const productFrom =
  'catalogue_product p LEFT JOIN catalogue_category c ON c.id = p.category_id';
