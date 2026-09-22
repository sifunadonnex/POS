import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { type SaleActor, SalesWrites } from './sales-writes.js';

type RequestBody = {
  requestId?: unknown;
  reason?: unknown;
  lines?: unknown;
};

type CheckoutBody = RequestBody & {
  cashTenderedMinor?: unknown;
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

export type CheckoutResult = {
  saleId: string;
  totalMinor: number;
  lines: BasketQuoteLine[];
  payment: {
    paymentId: string;
    shiftId: string;
    kind: 'cash';
    amountMinor: number;
    tenderedMinor: number;
    changeMinor: number;
  };
};

type RequestedBasketLine = {
  productId: string;
  unit: SaleUnit;
  quantity: number;
};

function isInteger(value: number): boolean {
  return Number.isFinite(value) && Number.isInteger(value);
}

@Injectable()
export class SalesService {
  constructor(
    @Inject(SalesWrites) private readonly writes?: SalesWrites,
    @Inject(DatabaseService) private readonly database?: DatabaseService,
  ) {}

  private validateQuantity(unit: SaleUnit, quantity: number): void {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new BadRequestException('Quantity must be greater than zero');
    }

    if (unit === 'each' || unit === 'pack') {
      if (!isInteger(quantity)) {
        throw new BadRequestException(
          'Quantity for each and pack must be a whole number',
        );
      }
      return;
    }

    const thousands = Math.round(quantity * 1000);
    if (Math.abs(thousands / 1000 - quantity) > 1e-9) {
      throw new BadRequestException(
        'Quantity for kg and l must use increments of 0.001',
      );
    }
  }

  private toMinor(quantity: number, unit: SaleUnit): number {
    if (unit === 'each' || unit === 'pack') {
      if (!Number.isInteger(quantity)) {
        throw new BadRequestException(
          'Quantity for each and pack must be a whole number',
        );
      }
      return quantity;
    }
    return Math.round(quantity * 1000);
  }

  private parseRequestedLines(lines: unknown): RequestedBasketLine[] {
    if (!Array.isArray(lines) || lines.length === 0 || lines.length > 100) {
      throw new BadRequestException(
        'Provide between one and one hundred basket lines',
      );
    }

    return lines.map((line, index) => {
      if (!line || typeof line !== 'object' || Array.isArray(line)) {
        throw new BadRequestException(`Invalid basket line at index ${index}`);
      }
      const candidate = line as Record<string, unknown>;
      const productId =
        typeof candidate.productId === 'string' &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          candidate.productId.trim(),
        )
          ? candidate.productId.trim()
          : null;
      const unit = candidate.unit;
      const quantity = Number(candidate.quantity);
      if (!productId)
        throw new BadRequestException(
          `Basket line ${index} must include a valid productId`,
        );
      if (unit !== 'each' && unit !== 'pack' && unit !== 'kg' && unit !== 'l') {
        throw new BadRequestException(
          `Basket line ${index} has an invalid unit`,
        );
      }
      this.validateQuantity(unit, quantity);
      return { productId, unit, quantity };
    });
  }

  private lineTotalMinor(
    quantity: number,
    priceMinor: number,
    unit: SaleUnit,
  ): number {
    if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) {
      throw new BadRequestException(
        'Price must be a non-negative integer minor amount',
      );
    }
    const quantityInThousandths =
      BigInt(this.toMinor(quantity, unit)) *
      (unit === 'each' || unit === 'pack' ? 1000n : 1n);
    const totalInThousandths = quantityInThousandths * BigInt(priceMinor);
    if (totalInThousandths % 1000n !== 0n) {
      throw new BadRequestException(
        'Line total is fractional in minor units; rounding policy is required',
      );
    }
    const total = totalInThousandths / 1000n;
    if (total > BigInt(Number.MAX_SAFE_INTEGER))
      throw new BadRequestException('Line total is too large');
    return Number(total);
  }

  quoteBasket(lines: unknown): BasketQuote {
    const parsed = this.parseRequestedLines(lines).map((line, index) => {
      const raw = (lines as Array<Record<string, unknown>>)[index];
      const priceMinor = Number(raw.priceMinor);
      if (!Number.isSafeInteger(priceMinor) || priceMinor < 0) {
        throw new BadRequestException(
          `Basket line ${index} must include a valid integer price`,
        );
      }
      return {
        ...line,
        priceMinor,
        lineTotalMinor: this.lineTotalMinor(
          line.quantity,
          priceMinor,
          line.unit,
        ),
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

  async quoteCurrentBasket(lines: unknown): Promise<BasketQuote> {
    if (!this.database)
      throw new Error('Database is required for a current basket quote');
    const requested = this.parseRequestedLines(lines);
    const result = await this.database.connectionPool.query<{
      id: string;
      unit: SaleUnit;
      price_minor: string;
      active: boolean;
    }>(
      'SELECT id, unit, price_minor::text, active FROM catalogue_product WHERE id = ANY($1::uuid[])',
      [requested.map((line) => line.productId)],
    );
    const products = new Map(result.rows.map((row) => [row.id, row]));
    const serverLines = requested.map((line) => {
      const product = products.get(line.productId);
      if (!product) throw new NotFoundException('Product not found');
      if (!product.active)
        throw new ConflictException('Only active products can be sold');
      if (product.unit !== line.unit)
        throw new ConflictException(
          'Product unit does not match the basket line',
        );
      const priceMinor = Number(product.price_minor);
      return {
        ...line,
        priceMinor,
        lineTotalMinor: this.lineTotalMinor(
          line.quantity,
          priceMinor,
          product.unit,
        ),
      } satisfies BasketQuoteLine;
    });
    const totalMinor = serverLines.reduce(
      (sum, line) => sum + line.lineTotalMinor,
      0,
    );
    return { subtotalMinor: totalMinor, totalMinor, lines: serverLines };
  }

  async finalize(actor: SaleActor, value: unknown) {
    const body =
      value && typeof value === 'object' ? (value as RequestBody) : {};
    const requestId =
      typeof body.requestId === 'string' && body.requestId.trim()
        ? body.requestId
        : null;
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 3
        ? body.reason.trim()
        : null;
    if (!requestId) {
      throw new BadRequestException('Provide a valid request ID');
    }
    if (!reason) {
      throw new BadRequestException(
        'Reason must contain at least three characters',
      );
    }
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      throw new BadRequestException('Provide at least one basket line');
    }

    if (!this.writes) throw new Error('Sales writes are not configured');
    const requested = this.parseRequestedLines(body.lines);
    return this.writes.execute(
      actor,
      requestId,
      { reason, lines: body.lines },
      (client) => this.createSale(client, actor, reason, requested),
    );
  }

  async checkout(actor: SaleActor, value: unknown): Promise<CheckoutResult> {
    const body =
      value && typeof value === 'object' ? (value as CheckoutBody) : {};
    const requestId =
      typeof body.requestId === 'string' && body.requestId.trim()
        ? body.requestId
        : null;
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 3
        ? body.reason.trim()
        : null;
    const cashTenderedMinor = Number(body.cashTenderedMinor);
    if (!requestId) throw new BadRequestException('Provide a valid request ID');
    if (!reason)
      throw new BadRequestException(
        'Reason must contain at least three characters',
      );
    if (!Array.isArray(body.lines) || body.lines.length === 0) {
      throw new BadRequestException('Provide at least one basket line');
    }
    if (!Number.isSafeInteger(cashTenderedMinor) || cashTenderedMinor <= 0) {
      throw new BadRequestException(
        'Cash received must be a positive integer minor amount',
      );
    }
    if (!this.writes) throw new Error('Sales writes are not configured');
    const requested = this.parseRequestedLines(body.lines);

    return this.writes.execute(
      actor,
      requestId,
      { reason, lines: body.lines, cashTenderedMinor },
      async (client) => {
        const shift = await client.query<{ id: string }>(
          `SELECT id FROM cash_shift
          WHERE cashier_id = $1 AND status = 'open'
          ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
          [actor.userId],
        );
        if (!shift.rowCount) {
          throw new ConflictException(
            'Open a register shift before recording a payment',
          );
        }

        const sale = await this.createSale(client, actor, reason, requested);
        if (cashTenderedMinor < sale.totalMinor) {
          throw new BadRequestException(
            'Cash received is less than the sale total',
          );
        }
        const changeMinor = cashTenderedMinor - sale.totalMinor;
        const shiftId = shift.rows[0].id;
        const payment = await client.query<{ id: string }>(
          `INSERT INTO sale_payment (id, sale_id, shift_id, kind, amount_minor, tendered_minor, status, reason, created_at)
          VALUES ($1, $2, $3, 'cash', $4, $5, 'paid', $6, now()) RETURNING id`,
          [
            randomUUID(),
            sale.saleId,
            shiftId,
            sale.totalMinor,
            cashTenderedMinor,
            reason,
          ],
        );
        await client.query(
          `INSERT INTO cash_movement (id, shift_id, payment_id, kind, amount_minor, reason, created_at)
          VALUES ($1, $2, $3, 'cash_in', $4, $5, now())`,
          [
            randomUUID(),
            shiftId,
            payment.rows[0].id,
            cashTenderedMinor,
            reason,
          ],
        );
        if (changeMinor > 0) {
          await client.query(
            `INSERT INTO cash_movement (id, shift_id, kind, amount_minor, reason, created_at)
            VALUES ($1, $2, 'cash_out', $3, $4, now())`,
            [randomUUID(), shiftId, changeMinor, `Change for ${sale.saleId}`],
          );
        }
        return {
          ...sale,
          payment: {
            paymentId: payment.rows[0].id,
            shiftId,
            kind: 'cash',
            amountMinor: sale.totalMinor,
            tenderedMinor: cashTenderedMinor,
            changeMinor,
          },
        };
      },
    );
  }

  private async createSale(
    client: import('pg').PoolClient,
    actor: SaleActor,
    reason: string,
    requested: RequestedBasketLine[],
  ) {
    const products = new Map<
      string,
      {
        id: string;
        unit: SaleUnit;
        price_minor: string;
        active: boolean;
        quantity_minor: string;
      }
    >();
    const quantities = new Map<string, number>();
    for (const line of requested) {
      quantities.set(
        line.productId,
        (quantities.get(line.productId) ?? 0) +
          this.toMinor(line.quantity, line.unit),
      );
    }
    for (const line of requested) {
      const knownProduct = products.get(line.productId);
      if (knownProduct) {
        if (knownProduct.unit !== line.unit)
          throw new ConflictException(
            'Product unit does not match the basket line',
          );
        continue;
      }
      const product = await client.query<{
        id: string;
        unit: SaleUnit;
        price_minor: string;
        active: boolean;
        quantity_minor: string;
      }>(
        `SELECT p.id, p.unit, p.price_minor::text, p.active, COALESCE(s.quantity_minor, 0)::text AS quantity_minor
            FROM catalogue_product p LEFT JOIN inventory_stock s ON s.product_id = p.id
            WHERE p.id = $1 FOR UPDATE OF p`,
        [line.productId],
      );
      const row = product.rows[0];
      if (!row) throw new NotFoundException('Product not found');
      if (!row.active)
        throw new ConflictException('Only active products can be sold');
      if (row.unit !== line.unit)
        throw new ConflictException(
          'Product unit does not match the basket line',
        );
      products.set(line.productId, row);
    }

    const quoteLines = requested
      .map((line) => {
        const product = products.get(line.productId);
        if (!product) throw new NotFoundException('Product not found');
        const quantityMinor = quantities.get(line.productId) ?? 0;
        const quantity =
          product.unit === 'each' || product.unit === 'pack'
            ? quantityMinor
            : quantityMinor / 1000;
        const priceMinor = Number(product.price_minor);
        return {
          productId: line.productId,
          unit: product.unit,
          quantity,
          priceMinor,
          lineTotalMinor: this.lineTotalMinor(
            quantity,
            priceMinor,
            product.unit,
          ),
        } satisfies BasketQuoteLine;
      })
      .filter(
        (line, index, all) =>
          all.findIndex(
            (candidate) => candidate.productId === line.productId,
          ) === index,
      );
    const totalMinor = quoteLines.reduce(
      (sum, line) => sum + line.lineTotalMinor,
      0,
    );

    for (const line of quoteLines) {
      const product = products.get(line.productId);
      if (!product) throw new NotFoundException('Product not found');
      const after =
        Number(product.quantity_minor) -
        this.toMinor(line.quantity, product.unit);
      if (after < 0) throw new ConflictException('Insufficient stock');
      await client.query(
        `UPDATE inventory_stock SET quantity_minor = $1, updated_at = now() WHERE product_id = $2`,
        [after, line.productId],
      );
    }

    const saleId = randomUUID();
    const saleResult = await client.query<{ id: string }>(
      `INSERT INTO sale (id, actor_id, total_minor, status, reason, created_at)
          VALUES ($1, $2, $3, 'completed', $4, now()) RETURNING id`,
      [saleId, actor.userId, totalMinor, reason],
    );

    for (const line of quoteLines) {
      const product = products.get(line.productId);
      if (!product) throw new NotFoundException('Product not found');
      const after =
        Number(product.quantity_minor) -
        this.toMinor(line.quantity, product.unit);
      await client.query(
        `INSERT INTO sale_line (id, sale_id, product_id, quantity_minor, unit_price_minor, line_total_minor)
            VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          randomUUID(),
          saleResult.rows[0].id,
          line.productId,
          this.toMinor(line.quantity, product.unit),
          line.priceMinor,
          line.lineTotalMinor,
        ],
      );

      await client.query(
        `INSERT INTO inventory_movement (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
            VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          line.productId,
          'sale',
          -this.toMinor(line.quantity, product.unit),
          after,
          actor.userId,
          reason,
        ],
      );
    }

    return {
      saleId: saleResult.rows[0].id,
      totalMinor,
      lines: quoteLines,
    };
  }

  async recordPayment(actor: SaleActor, value: unknown) {
    const body =
      value && typeof value === 'object'
        ? (value as Record<string, unknown>)
        : {};
    const requestId =
      typeof body.requestId === 'string' && body.requestId.trim()
        ? body.requestId
        : null;
    const saleId =
      typeof body.saleId === 'string' && body.saleId.trim()
        ? body.saleId
        : null;
    const kind =
      body.kind === 'cash' || body.kind === 'card' || body.kind === 'mpesa'
        ? body.kind
        : null;
    const amountMinor = Number(body.amountMinor);
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 3
        ? body.reason.trim()
        : null;

    if (!requestId) throw new BadRequestException('Provide a valid request ID');
    if (!saleId) throw new BadRequestException('Provide a valid sale ID');
    if (!kind) throw new BadRequestException('Provide a valid payment kind');
    if (kind !== 'cash') {
      throw new ConflictException(
        'Card and M-Pesa payments are not configured for this register',
      );
    }
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0)
      throw new BadRequestException(
        'Payment amount must be a positive integer minor amount',
      );
    if (!reason)
      throw new BadRequestException(
        'Reason must contain at least three characters',
      );

    if (!this.writes) throw new Error('Sales writes are not configured');
    return this.writes.executePayment(
      actor,
      requestId,
      { saleId, kind, amountMinor, reason },
      async (client) => {
        const sale = await client.query<{
          total_minor: number;
          status: string;
        }>('SELECT total_minor, status FROM sale WHERE id = $1 FOR UPDATE', [
          saleId,
        ]);
        if (!sale.rowCount) {
          throw new NotFoundException('Sale not found');
        }
        if (sale.rows[0].status !== 'completed')
          throw new ConflictException('Only completed sales can be paid');
        const total = Number(sale.rows[0].total_minor ?? 0);
        const paid = await client.query<{ paid_minor: string }>(
          `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE status = 'paid'), 0)::text AS paid_minor
          FROM sale_payment WHERE sale_id = $1`,
          [saleId],
        );
        const paidMinor = Number(paid.rows[0]?.paid_minor ?? 0);
        if (paidMinor + amountMinor > total) {
          throw new ConflictException('Payment exceeds sale total');
        }

        const shift = await client.query<{ id: string }>(
          `SELECT id FROM cash_shift
          WHERE cashier_id = $1 AND status = 'open'
          ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
          [actor.userId],
        );
        if (!shift.rowCount) {
          throw new ConflictException(
            'Open a register shift before recording a payment',
          );
        }
        const shiftId = shift.rows[0].id;

        const paymentId = randomUUID();
        const payment = await client.query<{ id: string }>(
          `INSERT INTO sale_payment (id, sale_id, shift_id, kind, amount_minor, status, reason, created_at)
          VALUES ($1, $2, $3, $4, $5, 'paid', $6, now()) RETURNING id`,
          [paymentId, saleId, shiftId, kind, amountMinor, reason],
        );

        if (kind === 'cash') {
          await client.query(
            `INSERT INTO cash_movement (id, shift_id, payment_id, kind, amount_minor, reason, created_at)
            VALUES ($1, $2, $3, 'cash_in', $4, $5, now())`,
            [randomUUID(), shiftId, payment.rows[0].id, amountMinor, reason],
          );
        }

        return {
          paymentId: payment.rows[0].id,
          saleId,
          shiftId,
          kind,
          amountMinor,
          totalMinor: total,
        };
      },
    );
  }
}
