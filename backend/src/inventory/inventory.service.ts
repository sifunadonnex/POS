import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import {
  quantityInput,
  requestInput,
  textInput,
  uuidInput,
} from './inventory.input.js';
import { InventoryWrites, type InventoryActor } from './inventory-writes.js';

export type StockRow = {
  productId: string;
  sku: string;
  name: string;
  unit: 'each' | 'pack' | 'kg' | 'l';
  quantityMinor: number;
  active: boolean;
};

@Injectable()
export class InventoryService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(InventoryWrites) private readonly writes: InventoryWrites,
  ) {}

  private toMinor(quantity: number, unit: StockRow['unit']): number {
    if (unit === 'each' || unit === 'pack') {
      if (!Number.isInteger(quantity)) {
        throw new BadRequestException(`Quantity must be a whole number for ${unit}`);
      }
      return quantity;
    }
    return Math.round(quantity * 1000);
  }

  async stock(search: unknown, page: unknown) {
    const query =
      search === undefined || search === '' ? '' : textInput(search, 'search', 160);
    const pageNumber = page === undefined ? 0 : Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 0 || pageNumber > 200) {
      throw new BadRequestException('Invalid page');
    }

    try {
      const result = await this.database.connectionPool.query<StockRow>(
        `SELECT p.id AS "productId", p.sku, p.name, p.unit,
        COALESCE(s.quantity_minor, 0) AS "quantityMinor", p.active
        FROM catalogue_product p
        LEFT JOIN inventory_stock s ON s.product_id = p.id
        WHERE ($1 = '' OR strpos(lower(p.name || ' ' || p.sku), lower($1)) > 0)
        ORDER BY lower(p.name), p.id LIMIT 51 OFFSET $2`,
        [query, pageNumber * 50],
      );
      return {
        stock: result.rows.slice(0, 50),
        hasMore: result.rows.length > 50,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Stock records are temporarily unavailable.',
      );
    }
  }

  async history(productId: string, page: unknown) {
    const id = uuidInput(productId, 'productId');
    const pageNumber = page === undefined ? 0 : Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 0 || pageNumber > 200) {
      throw new BadRequestException('Invalid page');
    }

    try {
      const result = await this.database.connectionPool.query(
        `SELECT m.id, m.kind, m.delta_minor AS "deltaMinor", m.quantity_after_minor AS "quantityAfterMinor",
        m.reason, m.created_at AS "createdAt", u.name AS "actorName"
        FROM inventory_movement m JOIN "user" u ON u.id = m.actor_id
        WHERE m.product_id = $1 ORDER BY m.created_at DESC LIMIT 51 OFFSET $2`,
        [id, pageNumber * 50],
      );
      return {
        history: result.rows.slice(0, 50),
        hasMore: result.rows.length > 50,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Stock history is temporarily unavailable.',
      );
    }
  }

  private async nextProduct(client: PoolClient, productId: string) {
    const result = await client.query<{
      id: string;
      unit: StockRow['unit'];
      active: boolean;
      quantity_minor: number;
    }>(
      `SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor
      FROM catalogue_product p
      LEFT JOIN inventory_stock s ON s.product_id = p.id
      WHERE p.id = $1 FOR UPDATE`,
      [productId],
    );
    const row = result.rows[0];
    if (!row) {
      throw new NotFoundException('Product not found');
    }
    if (!row.active) {
      throw new ConflictException('Only active products can be adjusted');
    }
    return row;
  }

  async adjust(actor: InventoryActor, value: unknown) {
    const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const productId = uuidInput(body.productId, 'productId');
    const input = requestInput(value);

    return this.writes.execute(
      actor,
      input.requestId,
      input.reason,
      { productId, quantity: body.quantity, reason: input.reason },
      async (client) => {
        const product = await this.nextProduct(client, productId);
        const quantity = quantityInput(body.quantity, product.unit, 'quantity');
        const delta = this.toMinor(quantity, product.unit);
        const current = Number(product.quantity_minor ?? 0);
        const after = current + delta;
        if (after < 0) {
          throw new ConflictException('Insufficient stock');
        }

        await client.query(
          `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (product_id) DO UPDATE SET
          unit = EXCLUDED.unit,
          quantity_minor = inventory_stock.quantity_minor + EXCLUDED.quantity_minor,
          updated_at = now()`,
          [productId, product.unit, delta],
        );

        const movement = await client.query<{ id: string }>(
          `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [randomUUID(), productId, 'adjustment', delta, after, actor.userId, input.reason],
        );

        return {
          productId,
          unit: product.unit,
          quantityMinor: after,
          movementId: movement.rows[0].id,
        };
      },
    );
  }

  async receive(actor: InventoryActor, value: unknown) {
    const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const productId = uuidInput(body.productId, 'productId');
    const input = requestInput(value);

    return this.writes.execute(
      actor,
      input.requestId,
      input.reason,
      { productId, quantity: body.quantity, reason: input.reason, kind: 'receive' },
      async (client) => {
        const product = await this.nextProduct(client, productId);
        const quantity = quantityInput(body.quantity, product.unit, 'quantity');
        const delta = this.toMinor(quantity, product.unit);
        if (delta <= 0) {
          throw new BadRequestException('Receiving quantity must be positive');
        }

        const current = Number(product.quantity_minor ?? 0);
        const after = current + delta;
        await client.query(
          `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (product_id) DO UPDATE SET
          unit = EXCLUDED.unit,
          quantity_minor = inventory_stock.quantity_minor + EXCLUDED.quantity_minor,
          updated_at = now()`,
          [productId, product.unit, delta],
        );

        const movement = await client.query<{ id: string }>(
          `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [randomUUID(), productId, 'receive', delta, after, actor.userId, input.reason],
        );

        return {
          productId,
          unit: product.unit,
          quantityMinor: after,
          movementId: movement.rows[0].id,
        };
      },
    );
  }

  async opening(actor: InventoryActor, value: unknown) {
    const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const productId = uuidInput(body.productId, 'productId');
    const input = requestInput(value);

    return this.writes.execute(
      actor,
      input.requestId,
      input.reason,
      { productId, quantity: body.quantity, reason: input.reason, kind: 'opening' },
      async (client) => {
        const product = await this.nextProduct(client, productId);
        const quantity = quantityInput(body.quantity, product.unit, 'quantity');
        const delta = this.toMinor(quantity, product.unit);
        if (delta < 0) {
          throw new BadRequestException('Opening stock cannot be negative');
        }

        const current = Number(product.quantity_minor ?? 0);
        const after = current + delta;
        await client.query(
          `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (product_id) DO UPDATE SET
          unit = EXCLUDED.unit,
          quantity_minor = inventory_stock.quantity_minor + EXCLUDED.quantity_minor,
          updated_at = now()`,
          [productId, product.unit, delta],
        );

        const movement = await client.query<{ id: string }>(
          `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [randomUUID(), productId, 'opening', delta, after, actor.userId, input.reason],
        );

        return {
          productId,
          unit: product.unit,
          quantityMinor: after,
          movementId: movement.rows[0].id,
        };
      },
    );
  }
}
