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
  constructor(@Inject(ReturnsWrites) private readonly writes: ReturnsWrites) {}

  private validateReturnLines(lines: unknown): ReturnLineInput[] {
    if (!Array.isArray(lines) || lines.length === 0) {
      throw new BadRequestException('Provide at least one return line');
    }

    return lines.map((line, index) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        throw new BadRequestException(`Return line ${index} must be an object`);
      }
      const candidate = line as Record<string, unknown>;
      const productId =
        typeof candidate.productId === 'string' && candidate.productId.trim()
          ? candidate.productId
          : null;
      const quantityMinor = Number(candidate.quantityMinor);
      const unitPriceMinor =
        candidate.unitPriceMinor === undefined
          ? 0
          : Number(candidate.unitPriceMinor);

      if (!productId) {
        throw new BadRequestException(
          `Return line ${index} must include a productId`,
        );
      }
      if (
        !Number.isFinite(quantityMinor) ||
        quantityMinor <= 0 ||
        !Number.isInteger(quantityMinor)
      ) {
        throw new BadRequestException(
          `Return line ${index} has an invalid quantityMinor`,
        );
      }
      if (
        !Number.isFinite(unitPriceMinor) ||
        unitPriceMinor < 0 ||
        !Number.isSafeInteger(unitPriceMinor)
      ) {
        throw new BadRequestException(
          `Return line ${index} has an invalid unitPriceMinor`,
        );
      }

      return { productId, quantityMinor, unitPriceMinor };
    });
  }

  private lineTotalMinor(
    quantityMinor: number,
    unitPriceMinor: number,
    unit: 'each' | 'pack' | 'kg' | 'l',
  ): number {
    const raw = BigInt(quantityMinor) * BigInt(unitPriceMinor);
    if (unit !== 'each' && unit !== 'pack' && raw % 1000n !== 0n) {
      throw new BadRequestException(
        'Refund line is fractional in minor units; rounding policy is required',
      );
    }
    const total = unit === 'each' || unit === 'pack' ? raw : raw / 1000n;
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      throw new BadRequestException('Refund line is too large');
    return Number(total);
  }

  async createReturn(actor: ReturnActor, value: unknown) {
    const body =
      value && typeof value === 'object' ? (value as ReturnCreateInput) : {};
    const requestId =
      typeof body.requestId === 'string' && body.requestId.trim()
        ? body.requestId
        : null;
    const saleId =
      typeof body.saleId === 'string' && body.saleId.trim()
        ? body.saleId
        : null;
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 3
        ? body.reason.trim()
        : null;
    const lines = this.validateReturnLines(body.lines);

    if (!requestId) {
      throw new BadRequestException('Provide a valid request ID');
    }
    if (!saleId) {
      throw new BadRequestException('Provide a valid sale ID');
    }
    if (!reason) {
      throw new BadRequestException(
        'Reason must contain at least three characters',
      );
    }

    return this.writes.execute(
      actor,
      requestId,
      { saleId, reason, lines },
      async (client) => {
        const sale = await client.query<{
          id: string;
          total_minor: number;
          status: string;
        }>(
          'SELECT id, total_minor, status FROM sale WHERE id = $1 FOR UPDATE',
          [saleId],
        );
        if (!sale.rowCount) {
          throw new NotFoundException('Sale not found');
        }
        if (sale.rows[0].status !== 'completed')
          throw new ConflictException('Only completed sales can be returned');

        const previousRefunds = await client.query<{ refund_minor: string }>(
          `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE status = 'paid'), 0)::text AS refund_minor
          FROM sale_refund WHERE sale_id = $1`,
          [saleId],
        );
        const refundedMinor = Number(
          previousRefunds.rows[0]?.refund_minor ?? 0,
        );

        let amountMinor = 0;
        const pendingReturns = new Map<string, number>();
        const seenProducts = new Set<string>();
        const resolvedLines: Array<{
          line: ReturnLineInput;
          source: {
            id: string;
            product_id: string;
            unit: 'each' | 'pack' | 'kg' | 'l';
            unit_price_minor: number;
          };
          row: {
            id: string;
            unit: 'each' | 'pack' | 'kg' | 'l';
            quantity_minor: number;
          };
          after: number;
        }> = [];
        for (const line of lines) {
          if (seenProducts.has(line.productId))
            throw new BadRequestException(
              'Return lines must contain each product only once',
            );
          seenProducts.add(line.productId);
          const saleLine = await client.query<{
            id: string;
            product_id: string;
            unit: 'each' | 'pack' | 'kg' | 'l';
            quantity_minor: number;
            unit_price_minor: number;
          }>(
            `SELECT sl.id, sl.product_id, p.unit, sl.quantity_minor, sl.unit_price_minor
            FROM sale s
            JOIN sale_line sl ON sl.sale_id = s.id
            JOIN catalogue_product p ON p.id = sl.product_id
            WHERE s.id = $1 AND sl.product_id = $2 AND s.status = 'completed' FOR UPDATE`,
            [saleId, line.productId],
          );
          if (!saleLine.rowCount) {
            throw new ConflictException('Sale line not available for return');
          }
          if (saleLine.rowCount > 1) {
            throw new ConflictException(
              'Return must identify a unique sale line',
            );
          }

          const source = saleLine.rows[0];
          const alreadyReturned = await client.query<{
            quantity_minor: string;
          }>(
            `SELECT COALESCE(SUM(quantity_minor), 0)::text AS quantity_minor
            FROM sale_return_line rl JOIN sale_return r ON r.id = rl.return_id
            WHERE rl.sale_line_id = $1 AND r.status IN ('requested', 'approved', 'completed')`,
            [source.id],
          );
          const returnedQuantity =
            Number(alreadyReturned.rows[0]?.quantity_minor ?? 0) +
            (pendingReturns.get(source.id) ?? 0);
          if (
            returnedQuantity + line.quantityMinor >
            Number(source.quantity_minor ?? 0)
          ) {
            throw new ConflictException(
              'Return quantity exceeds the sold quantity',
            );
          }
          pendingReturns.set(
            source.id,
            (pendingReturns.get(source.id) ?? 0) + line.quantityMinor,
          );

          const lineAmount = this.lineTotalMinor(
            line.quantityMinor,
            Number(source.unit_price_minor),
            source.unit,
          );
          amountMinor += lineAmount;

          const product = await client.query<{
            id: string;
            unit: 'each' | 'pack' | 'kg' | 'l';
            active: boolean;
            quantity_minor: number;
          }>(
            `SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor
            FROM catalogue_product p
            LEFT JOIN inventory_stock s ON s.product_id = p.id
            WHERE p.id = $1 FOR UPDATE OF p`,
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
          resolvedLines.push({ line, source, row, after });
        }

        if (
          refundedMinor + amountMinor >
          Number(sale.rows[0].total_minor ?? 0)
        ) {
          throw new ConflictException('Refund exceeds the sale total');
        }

        const returnResult = await client.query<{ id: string }>(
          `INSERT INTO sale_return (id, sale_id, actor_id, reason, total_minor, status, created_at)
          VALUES ($1, $2, $3, $4, $5, 'completed', now()) RETURNING id`,
          [randomUUID(), saleId, actor.userId, reason, amountMinor],
        );

        for (const resolved of resolvedLines) {
          await client.query(
            `INSERT INTO sale_return_line (id, return_id, sale_line_id, product_id, quantity_minor, unit_price_minor, created_at)
            VALUES ($1, $2, $3, $4, $5, $6, now())`,
            [
              randomUUID(),
              returnResult.rows[0].id,
              resolved.source.id,
              resolved.line.productId,
              resolved.line.quantityMinor,
              Number(resolved.source.unit_price_minor),
            ],
          );
          await client.query(
            `INSERT INTO inventory_stock (product_id, unit, quantity_minor, updated_at)
            VALUES ($1, $2, $3, now())
            ON CONFLICT (product_id) DO UPDATE SET
            unit = EXCLUDED.unit,
            quantity_minor = inventory_stock.quantity_minor + EXCLUDED.quantity_minor,
            updated_at = now()`,
            [
              resolved.line.productId,
              resolved.row.unit,
              resolved.line.quantityMinor,
            ],
          );
          await client.query(
            `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [
              randomUUID(),
              resolved.line.productId,
              'return',
              resolved.line.quantityMinor,
              resolved.after,
              actor.userId,
              reason,
            ],
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
