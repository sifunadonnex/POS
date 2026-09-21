import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type ReturnActor, ReturnsWrites } from './returns-writes.js';

export type ReturnLineInput = {
  productId: string;
  quantityMinor: number;
  unitPriceMinor: number;
};

export type ReturnCreateInput = {
  requestId?: unknown;
  saleId?: unknown;
  reason?: unknown;
  lines?: unknown;
};

@Injectable()
export class ReturnsService {
  constructor(
    @Inject(ReturnsWrites) private readonly writes: ReturnsWrites,
  ) {}

  private validateReturnLines(lines: unknown): ReturnLineInput[] {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('Provide at least one return line');
    }

    return lines.map((line, index) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        throw new BadRequestException(`Return line ${index} must be an object`);
      }
      const candidate = line as Record<string, unknown>;
      const productId = typeof candidate.productId === 'string' && candidate.productId.trim() ? candidate.productId : null;
      const quantityMinor = Number(candidate.quantityMinor);
      const unitPriceMinor = Number(candidate.unitPriceMinor);

      if (!productId) {
        throw new BadRequestException(`Return line ${index} must include a productId`);
      }
      if (!Number.isFinite(quantityMinor) || quantityMinor <= 0 || !Number.isInteger(quantityMinor)) {
        throw new BadRequestException(`Return line ${index} has an invalid quantityMinor`);
      }
      if (!Number.isFinite(unitPriceMinor) || unitPriceMinor < 0 || !Number.isInteger(unitPriceMinor)) {
        throw new BadRequestException(`Return line ${index} has an invalid unitPriceMinor`);
      }

      return { productId, quantityMinor, unitPriceMinor };
    });
  }

  async createReturn(actor: ReturnActor, value: unknown) {
    const body = value && typeof value === 'object' ? (value as ReturnCreateInput) : {};
    const requestId = typeof body.requestId === 'string' && body.requestId.trim() ? body.requestId : null;
    const saleId = typeof body.saleId === 'string' && body.saleId.trim() ? body.saleId : null;
    const reason = typeof body.reason === 'string' && body.reason.trim().length >= 3 ? body.reason.trim() : null;
    const lines = this.validateReturnLines(body.lines);

    if (!requestId) {
      throw new BadRequestException('Provide a valid request ID');
    }
    if (!saleId) {
      throw new BadRequestException('Provide a valid sale ID');
    }
    if (!reason) {
      throw new BadRequestException('Reason must contain at least three characters');
    }

    return this.writes.execute(
      actor,
      requestId,
      { saleId, reason, lines },
      async (client) => {
        const sale = await client.query<{ id: string; total_minor: number }>(
          'SELECT id, total_minor FROM sale WHERE id = $1 FOR UPDATE',
          [saleId],
        );
        if (!sale.rowCount) {
          throw new NotFoundException('Sale not found');
        }

        const amountMinor = lines.reduce(
          (sum, line) => sum + Math.round((line.quantityMinor * line.unitPriceMinor) / 1000),
          0,
        );
        const returnId = randomUUID();
        const returnResult = await client.query<{ id: string }>(
          `INSERT INTO sale_return (id, sale_id, actor_id, reason, total_minor, status, created_at)
          VALUES ($1, $2, $3, $4, $5, 'requested', now()) RETURNING id`,
          [returnId, saleId, actor.userId, reason, amountMinor],
        );

        for (const line of lines) {
          const saleLine = await client.query<{
            id: string;
            status: string;
            product_id: string;
            quantity_minor: number;
            unit_price_minor: number;
          }>(
            `SELECT s.id, s.sale_id, s.status, sl.product_id, sl.quantity_minor, sl.unit_price_minor
            FROM sale s
            JOIN sale_line sl ON sl.sale_id = s.id
            WHERE s.id = $1 AND sl.product_id = $2 AND s.status = 'completed' FOR UPDATE`,
            [saleId, line.productId],
          );
          if (!saleLine.rowCount) {
            throw new ConflictException('Sale line not available for return');
          }

          const source = saleLine.rows[0];
          if (line.quantityMinor > Number(source.quantity_minor ?? 0)) {
            throw new ConflictException('Return quantity exceeds the sold quantity');
          }

          await client.query(
            `INSERT INTO sale_return_line (id, return_id, sale_line_id, product_id, quantity_minor, unit_price_minor, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, now())`,
            [randomUUID(), returnResult.rows[0].id, source.id, line.productId, line.quantityMinor, line.unitPriceMinor],
          );

          const product = await client.query<{ id: string; unit: 'each' | 'pack' | 'kg' | 'l'; active: boolean; quantity_minor: number }>(
            `SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor
            FROM catalogue_product p
            LEFT JOIN inventory_stock s ON s.product_id = p.id
            WHERE p.id = $1 FOR UPDATE`,
            [line.productId],
          );
          const row = product.rows[0];
          if (!row) {
            throw new NotFoundException('Product not found');
          }
          if (!row.active) {
            throw new ConflictException('Only active products can be returned');
          }

          const current = Number(row.quantity_minor ?? 0);
          const after = current + line.quantityMinor;

          await client.query(
            `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (product_id) DO UPDATE SET
            unit = EXCLUDED.unit,
            quantity_minor = inventory_stock.quantity_minor + EXCLUDED.quantity_minor,
            updated_at = now()`,
            [line.productId, row.unit, line.quantityMinor],
          );

          await client.query(
            `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomUUID(), line.productId, 'return', line.quantityMinor, after, actor.userId, reason],
          );
        }

        const refundResult = await client.query<{ id: string }>(
          `INSERT INTO sale_refund (id, sale_id, return_id, amount_minor, status, reason, created_at)
          VALUES ($1, $2, $3, $4, 'paid', $5, now()) RETURNING id`,
          [randomUUID(), saleId, returnResult.rows[0].id, amountMinor, reason],
        );

        return {
          returnId: returnResult.rows[0].id,
          saleId,
          amountMinor,
          refundId: refundResult.rows[0].id,
        };
      },
    );
  }
}
