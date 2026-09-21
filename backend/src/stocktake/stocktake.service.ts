import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type StocktakeActor, StocktakeWrites } from './stocktake-writes.js';

export type StocktakeCountInput = {
  requestId?: unknown;
  productId?: unknown;
  quantity?: unknown;
  reason?: unknown;
};

@Injectable()
export class StocktakeService {
  constructor(
    @Inject(StocktakeWrites) private readonly writes: StocktakeWrites,
  ) {}

  private toMinor(
    quantity: number,
    unit: 'each' | 'pack' | 'kg' | 'l',
  ): number {
    if (unit === 'each' || unit === 'pack') {
      if (!Number.isInteger(quantity)) {
        throw new BadRequestException(
          `Quantity must be a whole number for ${unit}`,
        );
      }
      return quantity;
    }
    const minor = Math.round(quantity * 1000);
    if (Math.abs(minor - quantity * 1000) > 1e-8) {
      throw new BadRequestException(
        `Quantity for ${unit} must use increments of 0.001`,
      );
    }
    return minor;
  }

  async count(actor: StocktakeActor, value: unknown) {
    const body =
      value && typeof value === 'object' ? (value as StocktakeCountInput) : {};
    const requestId =
      typeof body.requestId === 'string' && body.requestId.trim()
        ? body.requestId
        : null;
    const productId =
      typeof body.productId === 'string' && body.productId.trim()
        ? body.productId
        : null;
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 3
        ? body.reason.trim()
        : null;
    const quantity = Number(body.quantity);

    if (
      !requestId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        requestId,
      )
    )
      throw new BadRequestException('Provide a valid request ID');
    if (
      !productId ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        productId,
      )
    )
      throw new BadRequestException('Provide a valid product ID');
    if (!reason)
      throw new BadRequestException(
        'Reason must contain at least three characters',
      );
    if (!Number.isFinite(quantity) || quantity < 0)
      throw new BadRequestException('Quantity must be a non-negative number');

    return this.writes.execute(
      actor,
      requestId,
      { productId, quantity, reason },
      async (client) => {
        const product = await client.query<{
          id: string;
          unit: 'each' | 'pack' | 'kg' | 'l';
          active: boolean;
          quantity_minor: number;
        }>(
          `SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor
          FROM catalogue_product p
          LEFT JOIN inventory_stock s ON s.product_id = p.id
          WHERE p.id = $1 FOR UPDATE`,
          [productId],
        );
        const row = product.rows[0];
        if (!row) throw new NotFoundException('Product not found');
        if (!row.active)
          throw new ConflictException('Only active products can be counted');

        const countedMinor = this.toMinor(quantity, row.unit);
        const current = Number(row.quantity_minor ?? 0);
        const delta = countedMinor - current;

        await client.query(
          `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
          VALUES ($1, $2, $3, now())
          ON CONFLICT (product_id) DO UPDATE SET
          unit = EXCLUDED.unit,
          quantity_minor = EXCLUDED.quantity_minor,
          updated_at = now()`,
          [productId, row.unit, countedMinor],
        );

        const countId = await client.query<{ id: string }>(
          `INSERT INTO stocktake (id, product_id, counted_quantity_minor, previous_quantity_minor, delta_minor, actor_id, reason, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING id`,
          [
            randomUUID(),
            productId,
            countedMinor,
            current,
            delta,
            actor.userId,
            reason,
          ],
        );

        await client.query(
          `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
          VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            randomUUID(),
            productId,
            'stocktake',
            delta,
            countedMinor,
            actor.userId,
            reason,
          ],
        );

        return {
          countId: countId.rows[0].id,
          productId,
          quantityMinor: countedMinor,
          deltaMinor: delta,
          previousQuantityMinor: current,
        };
      },
    );
  }
}
