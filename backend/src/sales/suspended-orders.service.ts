import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { productColumns, type Product } from '../catalogue/catalogue.types.js';
import { DatabaseService } from '../database/database.service.js';
import { type SaleActor, SalesWrites } from './sales-writes.js';

type SaleUnit = 'each' | 'pack' | 'kg' | 'l';
type SuspendedOrderActor = SaleActor & { role: 'manager' | 'cashier' };
type Queryable = Pool | PoolClient;

type RequestedLine = {
  productId: string;
  unit: SaleUnit;
  quantityMinor: number;
  position: number;
};

export type SuspendedOrder = {
  id: string;
  ownerId: string;
  ownerName: string;
  note: string;
  status: 'held' | 'resumed' | 'cancelled';
  revision: number;
  createdAt: string;
  updatedAt: string;
  lines: Array<{ product: Product; quantity: number }>;
};

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function uuidInput(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value.trim())) {
    throw new BadRequestException(`${field} must be a valid UUID`);
  }
  return value.trim();
}

function revisionInput(value: unknown): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new BadRequestException('Revision must be a positive integer');
  }
  return revision;
}

function noteInput(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string' || value.trim().length > 160) {
    throw new BadRequestException(
      'Hold note must contain at most 160 characters',
    );
  }
  return value.trim();
}

function unitInput(value: unknown, index: number): SaleUnit {
  if (value !== 'each' && value !== 'pack' && value !== 'kg' && value !== 'l') {
    throw new BadRequestException(`Basket line ${index} has an invalid unit`);
  }
  return value;
}

function quantityMinorInput(
  value: unknown,
  unit: SaleUnit,
  index: number,
): number {
  const quantity = Number(value);
  if (!Number.isFinite(quantity) || quantity <= 0) {
    throw new BadRequestException(
      `Basket line ${index} has an invalid quantity`,
    );
  }
  if (unit === 'each' || unit === 'pack') {
    if (!Number.isSafeInteger(quantity)) {
      throw new BadRequestException(
        `Basket line ${index} requires a whole-number quantity`,
      );
    }
    return quantity;
  }
  const quantityMinor = Math.round(quantity * 1000);
  if (
    !Number.isSafeInteger(quantityMinor) ||
    Math.abs(quantityMinor / 1000 - quantity) > 1e-9
  ) {
    throw new BadRequestException(
      `Basket line ${index} must use increments of 0.001`,
    );
  }
  return quantityMinor;
}

function linesInput(value: unknown): RequestedLine[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > 100) {
    throw new BadRequestException(
      'Provide between one and one hundred basket lines',
    );
  }
  const combined = new Map<string, RequestedLine>();
  value.forEach((raw, index) => {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException(`Invalid basket line at index ${index}`);
    }
    const line = raw as Record<string, unknown>;
    const productId = uuidInput(line.productId, `Basket line ${index} product`);
    const unit = unitInput(line.unit, index);
    const quantityMinor = quantityMinorInput(line.quantity, unit, index);
    const previous = combined.get(productId);
    if (previous && previous.unit !== unit) {
      throw new BadRequestException('A product cannot use two basket units');
    }
    const total = (previous?.quantityMinor ?? 0) + quantityMinor;
    if (!Number.isSafeInteger(total)) {
      throw new BadRequestException('Basket quantity is too large');
    }
    combined.set(productId, {
      productId,
      unit,
      quantityMinor: total,
      position: previous?.position ?? combined.size,
    });
  });
  return [...combined.values()];
}

@Injectable()
export class SuspendedOrdersService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SalesWrites) private readonly writes: SalesWrites,
  ) {}

  async list(actor: SuspendedOrderActor) {
    try {
      return {
        orders: await this.loadOrders(
          this.database.connectionPool,
          actor,
          undefined,
          true,
        ),
      };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw new ServiceUnavailableException(
        'Held orders are temporarily unavailable.',
      );
    }
  }

  async create(actor: SuspendedOrderActor, value: unknown) {
    const body =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    const requestId = uuidInput(body.requestId, 'Request ID');
    const note = noteInput(body.note);
    const lines = linesInput(body.lines);

    return this.writes.executeSuspendedOrder(
      actor,
      requestId,
      { action: 'create', note, lines },
      async (client) => {
        await this.assertCurrentProducts(client, lines);
        const id = randomUUID();
        await client.query(
          `INSERT INTO suspended_order (id, owner_id, note)
          VALUES ($1, $2, $3)`,
          [id, actor.userId, note],
        );
        for (const line of lines) {
          await client.query(
            `INSERT INTO suspended_order_line
              (id, suspended_order_id, product_id, unit, quantity_minor, position)
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [
              randomUUID(),
              id,
              line.productId,
              line.unit,
              line.quantityMinor,
              line.position,
            ],
          );
        }
        return this.loadOne(client, actor, id);
      },
    );
  }

  resume(actor: SuspendedOrderActor, idValue: unknown, value: unknown) {
    return this.transition(actor, idValue, value, 'resumed');
  }

  cancel(actor: SuspendedOrderActor, idValue: unknown, value: unknown) {
    return this.transition(actor, idValue, value, 'cancelled');
  }

  private async transition(
    actor: SuspendedOrderActor,
    idValue: unknown,
    value: unknown,
    status: 'resumed' | 'cancelled',
  ) {
    const id = uuidInput(idValue, 'Held-order ID');
    const body =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    const requestId = uuidInput(body.requestId, 'Request ID');
    const revision = revisionInput(body.revision);
    return this.writes.executeSuspendedOrder(
      actor,
      requestId,
      { action: status, id, revision },
      async (client) => {
        const current = await client.query<{
          ownerId: string;
          status: string;
          revision: number;
        }>(
          `SELECT owner_id AS "ownerId", status, revision
          FROM suspended_order WHERE id = $1 FOR UPDATE`,
          [id],
        );
        const order = current.rows[0];
        if (
          !order ||
          (actor.role !== 'manager' && order.ownerId !== actor.userId)
        ) {
          throw new NotFoundException('Held order not found');
        }
        if (order.status !== 'held') {
          throw new ConflictException('Held order is no longer available');
        }
        if (order.revision !== revision) {
          throw new ConflictException('Held order changed. Reload and retry.');
        }
        if (status === 'resumed') {
          const lineRows = await client.query<{
            productId: string;
            unit: SaleUnit;
            quantityMinor: string;
          }>(
            `SELECT product_id AS "productId", unit,
              quantity_minor::text AS "quantityMinor"
            FROM suspended_order_line WHERE suspended_order_id = $1
            ORDER BY position`,
            [id],
          );
          await this.assertCurrentProducts(
            client,
            lineRows.rows.map((line, position) => ({
              productId: line.productId,
              unit: line.unit,
              quantityMinor: Number(line.quantityMinor),
              position,
            })),
          );
        }
        await client.query(
          `UPDATE suspended_order SET status = $2, revision = revision + 1,
            updated_at = now(),
            resumed_at = CASE WHEN $2 = 'resumed' THEN now() ELSE NULL END,
            cancelled_at = CASE WHEN $2 = 'cancelled' THEN now() ELSE NULL END
          WHERE id = $1`,
          [id, status],
        );
        return this.loadOne(client, actor, id);
      },
    );
  }

  private async assertCurrentProducts(
    client: Queryable,
    lines: RequestedLine[],
  ) {
    const result = await client.query<{
      id: string;
      unit: SaleUnit;
      active: boolean;
    }>(
      `SELECT id, unit, active FROM catalogue_product
      WHERE id = ANY($1::uuid[]) FOR SHARE`,
      [lines.map((line) => line.productId)],
    );
    const products = new Map(
      result.rows.map((product) => [product.id, product]),
    );
    for (const line of lines) {
      const product = products.get(line.productId);
      if (!product) throw new NotFoundException('Product not found');
      if (!product.active) {
        throw new ConflictException('Held orders can only use active products');
      }
      if (product.unit !== line.unit) {
        throw new ConflictException(
          'Product unit does not match the held line',
        );
      }
    }
  }

  private async loadOne(
    client: Queryable,
    actor: SuspendedOrderActor,
    id: string,
  ): Promise<SuspendedOrder> {
    const orders = await this.loadOrders(client, actor, id, false);
    const order = orders[0];
    if (!order) throw new NotFoundException('Held order not found');
    return order;
  }

  private async loadOrders(
    client: Queryable,
    actor: SuspendedOrderActor,
    id?: string,
    heldOnly = false,
  ): Promise<SuspendedOrder[]> {
    const orders = await client.query<{
      id: string;
      ownerId: string;
      ownerName: string;
      note: string;
      status: 'held' | 'resumed' | 'cancelled';
      revision: number;
      createdAt: string;
      updatedAt: string;
    }>(
      `SELECT so.id, so.owner_id AS "ownerId", staff.name AS "ownerName",
        so.note, so.status, so.revision, so.created_at AS "createdAt",
        so.updated_at AS "updatedAt"
      FROM suspended_order so JOIN "user" staff ON staff.id = so.owner_id
      WHERE ($1::uuid IS NULL OR so.id = $1)
        AND ($2::boolean = false OR so.status = 'held')
        AND ($3::boolean OR so.owner_id = $4)
      ORDER BY so.created_at DESC LIMIT 20`,
      [id ?? null, heldOnly, actor.role === 'manager', actor.userId],
    );
    if (!orders.rows.length) return [];
    const lines = await client.query<
      Product & {
        suspendedOrderId: string;
        heldUnit: SaleUnit;
        quantityMinor: string;
      }
    >(
      `SELECT sol.suspended_order_id AS "suspendedOrderId",
        sol.unit AS "heldUnit", sol.quantity_minor::text AS "quantityMinor",
        ${productColumns}
      FROM suspended_order_line sol
      JOIN catalogue_product p ON p.id = sol.product_id
      LEFT JOIN catalogue_category c ON c.id = p.category_id
      WHERE sol.suspended_order_id = ANY($1::uuid[])
      ORDER BY sol.suspended_order_id, sol.position`,
      [orders.rows.map((order) => order.id)],
    );
    const byOrder = new Map<string, SuspendedOrder['lines']>();
    for (const line of lines.rows) {
      const quantityMinor = Number(line.quantityMinor);
      if (!Number.isSafeInteger(quantityMinor) || quantityMinor <= 0) {
        throw new ServiceUnavailableException(
          'Held order contains an invalid quantity.',
        );
      }
      const quantity =
        line.heldUnit === 'each' || line.heldUnit === 'pack'
          ? quantityMinor
          : quantityMinor / 1000;
      const target = byOrder.get(line.suspendedOrderId) ?? [];
      target.push({
        product: {
          id: line.id,
          sku: line.sku,
          name: line.name,
          categoryId: line.categoryId,
          categoryName: line.categoryName,
          unit: line.unit,
          priceMinor: line.priceMinor,
          lowStockThresholdMinor: line.lowStockThresholdMinor,
          taxCode: line.taxCode,
          active: line.active,
          revision: line.revision,
          barcodes: line.barcodes,
        },
        quantity,
      });
      byOrder.set(line.suspendedOrderId, target);
    }
    return orders.rows.map((order) => ({
      ...order,
      createdAt: new Date(order.createdAt).toISOString(),
      updatedAt: new Date(order.updatedAt).toISOString(),
      lines: byOrder.get(order.id) ?? [],
    }));
  }
}
