import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import type { ProductInput } from './catalogue.input.js';
import type { CatalogueActor } from './catalogue-writes.js';
import {
  productColumns,
  productFrom,
  type Product,
} from './catalogue.types.js';

export async function readProduct(
  client: PoolClient,
  id: string,
): Promise<Product> {
  const result = await client.query<Product>(
    `SELECT ${productColumns} FROM ${productFrom} WHERE p.id = $1`,
    [id],
  );
  if (!result.rows[0])
    throw new Error('Catalogue product not found after write');
  return result.rows[0];
}
export async function replaceBarcodes(
  client: PoolClient,
  id: string,
  barcodes: string[],
) {
  await client.query('DELETE FROM catalogue_barcode WHERE product_id = $1', [
    id,
  ]);
  for (const code of barcodes)
    await client.query(
      'INSERT INTO catalogue_barcode (code, product_id) VALUES ($1, $2)',
      [code, id],
    );
}
export async function recordHistory(
  client: PoolClient,
  actor: CatalogueActor,
  reason: string,
  type: 'product' | 'category',
  snapshot: { id: string; revision: number },
) {
  await client.query(
    'INSERT INTO catalogue_history (entity_type, entity_id, revision, actor_id, reason, snapshot) VALUES ($1, $2, $3, $4, $5, $6)',
    [
      type,
      snapshot.id,
      snapshot.revision,
      actor.userId,
      reason,
      JSON.stringify(snapshot),
    ],
  );
}
export async function insertProduct(
  client: PoolClient,
  actor: CatalogueActor,
  reason: string,
  input: ProductInput,
): Promise<Product> {
  const id = randomUUID();
  await client.query(
    `INSERT INTO catalogue_product (id, sku, name, category_id, unit, price_minor, tax_code, active)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      id,
      input.sku,
      input.name,
      input.categoryId,
      input.unit,
      input.priceMinor,
      input.taxCode,
      input.active,
    ],
  );
  await replaceBarcodes(client, id, input.barcodes);
  const product = await readProduct(client, id);
  await recordHistory(client, actor, reason, 'product', product);
  return product;
}
