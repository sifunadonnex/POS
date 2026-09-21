import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type SaleActor, SalesWrites } from './sales-writes.js';

type RequestBody = {
  requestId?: unknown;
  reason?: unknown;
  lines?: unknown;
};

export type SaleUnit = 'each' | 'pack' | 'kg' | 'l';

export type BasketLineInput = {
  productId: string;
  unit: SaleUnit;
  quantity: number;
  priceMinor: number;
};

export type BasketQuoteLine = BasketLineInput & {
  lineTotalMinor: number;
};

export type BasketQuote = {
  subtotalMinor: number;
  totalMinor: number;
  lines: BasketQuoteLine[];
};

function isInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

@Injectable()
export class SalesService {
  constructor(
    @Inject(SalesWrites) private readonly writes: SalesWrites = undefined as unknown as SalesWrites,
  ) {}

  private validateQuantity(unit: SaleUnit, quantity: number): void {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Quantity must be greater than zero');
    }

    if (unit === 'each' || unit === 'pack') {
      if (!isInteger(quantity)) {
        throw new BadRequestException('Quantity for each and pack must be a whole number');
      }
      return;
    }

    const thousands = Math.round(quantity * 1000);
    if (Math.abs((thousands / 1000) - quantity) > 1e-9) {
      throw new BadRequestException('Quantity for kg and l must use increments of 0.001');
    }
  }

  private toMinor(quantity: number, unit: SaleUnit): number {
    if (unit === 'each' || unit === 'pack') {
      if (!Number.isInteger(quantity)) {
        throw new BadRequestException('Quantity for each and pack must be a whole number');
      }
      return quantity;
    }
    return Math.round(quantity * 1000);
  }

  quoteBasket(lines: unknown): BasketQuote {
    if (!Array.isArray(lines)) {
      throw new BadRequestException('Provide a basket of products');
    }

    const parsed = lines.map((line, index) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        throw new BadRequestException(`Invalid basket line at index ${index}`);
      }

      const candidate = line as Record<string, unknown>;
      const productId = typeof candidate.productId === 'string' && candidate.productId.trim() ? candidate.productId : null;
      const unit = candidate.unit;
      const quantity = Number(candidate.quantity);
      const priceMinor = Number(candidate.priceMinor);

      if (!productId) {
        throw new BadRequestException(`Basket line ${index} must include a productId`);
      }
      if (unit !== 'each' && unit !== 'pack' && unit !== 'kg' && unit !== 'l') {
        throw new BadRequestException(`Basket line ${index} has an invalid unit`);
      }
      if (!Number.isFinite(quantity) || !Number.isFinite(priceMinor) || priceMinor < 0) {
        throw new BadRequestException(`Basket line ${index} must include a valid quantity and price`);
      }
      this.validateQuantity(unit, quantity);

      const quantityInThousandths = BigInt(Math.round(quantity * 1000));
      const totalInThousandths = quantityInThousandths * BigInt(Math.round(priceMinor));
      const lineTotalMinor = Number(totalInThousandths) / 1000;

      return {
        productId,
        unit,
        quantity,
        priceMinor: Math.round(priceMinor),
        lineTotalMinor,
      } satisfies BasketQuoteLine;
    });

    const subtotalMinor = parsed.reduce(
      (sum, line) => sum + line.lineTotalMinor,
      0,
    );

    return {
      subtotalMinor,
      totalMinor: subtotalMinor,
      lines: parsed,
    };
  }

  async finalize(actor: SaleActor, value: unknown) {
    const body = value && typeof value === 'object' ? (value as RequestBody) : {};
    const requestId = typeof body.requestId === 'string' && body.requestId.trim()
      ? body.requestId
      : null;
    const reason = typeof body.reason === 'string' && body.reason.trim().length >= 3
      ? body.reason.trim()
      : null;
    if (!requestId) {
      throw new BadRequestException('Provide a valid request ID');
    }
    if (!reason) {
      throw new BadRequestException('Reason must contain at least three characters');
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      throw new BadRequestException('Provide at least one basket line');
    }

    const quote = this.quoteBasket(body.lines);
    return this.writes.execute(
      actor,
      requestId,
      { reason, lines: body.lines, totalMinor: quote.totalMinor },
      async (client) => {
        const saleId = randomUUID();
        const saleResult = await client.query<{ id: string }>(
          `INSERT INTO sale (id, actor_id, total_minor, status, reason, created_at)
          VALUES ($1, $2, $3, 'completed', $4, now()) RETURNING id`,
          [saleId, actor.userId, quote.totalMinor, reason],
        );

        for (const line of quote.lines) {
          const product = await client.query<{ id: string; unit: SaleUnit; active: boolean; quantity_minor: number }>(
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
            throw new ConflictException('Only active products can be sold');
          }
          if (row.unit !== line.unit) {
            throw new ConflictException('Product unit does not match the basket line');
          }

          const deltaMinor = this.toMinor(line.quantity, row.unit);
          const current = Number(row.quantity_minor ?? 0);
          const after = current - deltaMinor;
          if (after < 0) {
            throw new ConflictException('Insufficient stock');
          }

          await client.query(
            `UPDATE inventory_stock
            SET quantity_minor = $1, updated_at = now()
            WHERE product_id = $2`,
            [after, line.productId],
          );

          await client.query(
            `INSERT INTO sale_line (id, sale_id, product_id, quantity_minor, unit_price_minor, line_total_minor)
            VALUES ($1, $2, $3, $4, $5, $6)`,
            [randomUUID(), saleResult.rows[0].id, line.productId, deltaMinor, line.priceMinor, line.lineTotalMinor],
          );

          await client.query(
            `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [randomUUID(), line.productId, 'sale', -deltaMinor, after, actor.userId, reason],
          );
        }

        return {
          saleId: saleResult.rows[0].id,
          totalMinor: quote.totalMinor,
          lines: quote.lines,
        };
      },
    );
  }

  async recordPayment(actor: SaleActor, value: unknown) {
    const body = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
    const requestId = typeof body.requestId === 'string' && body.requestId.trim() ? body.requestId : null;
    const saleId = typeof body.saleId === 'string' && body.saleId.trim() ? body.saleId : null;
    const kind = body.kind === 'cash' || body.kind === 'card' || body.kind === 'mpesa' ? body.kind : null;
    const amountMinor = Number(body.amountMinor);
    const reason = typeof body.reason === 'string' && body.reason.trim().length >= 3 ? body.reason.trim() : null;

    if (!requestId) throw new BadRequestException('Provide a valid request ID');
    if (!saleId) throw new BadRequestException('Provide a valid sale ID');
    if (!kind) throw new BadRequestException('Provide a valid payment kind');
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) throw new BadRequestException('Payment amount must be greater than zero');
    if (!reason) throw new BadRequestException('Reason must contain at least three characters');

    return this.writes.execute(
      actor,
      requestId,
      { saleId, kind, amountMinor, reason },
      async (client) => {
        const sale = await client.query<{ total_minor: number }>(
          'SELECT total_minor FROM sale WHERE id = $1 FOR UPDATE',
          [saleId],
        );
        if (!sale.rowCount) {
          throw new NotFoundException('Sale not found');
        }
        const total = Number(sale.rows[0].total_minor ?? 0);
        if (amountMinor > total) {
          throw new ConflictException('Payment exceeds sale total');
        }

        const paymentId = randomUUID();
        const payment = await client.query<{ id: string }>(
          `INSERT INTO sale_payment (id, sale_id, kind, amount_minor, status, reason, created_at)
          VALUES ($1, $2, $3, $4, 'paid', $5, now()) RETURNING id`,
          [paymentId, saleId, kind, amountMinor, reason],
        );

        return {
          paymentId: payment.rows[0].id,
          saleId,
          kind,
          amountMinor,
          totalMinor: total,
        };
      },
    );
  }
}
