import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

type SaleUnit = 'each' | 'pack' | 'kg' | 'l';
type PaymentKind = 'cash' | 'card' | 'mpesa';
type LookupActor = { userId: string; role: 'manager' | 'cashier' };

export type SaleLedgerItem = {
  saleId: string;
  cashierId: string;
  cashierName: string;
  totalMinor: number;
  paidMinor: number;
  refundedMinor: number;
  balanceMinor: number;
  lineCount: number;
  paymentKinds: PaymentKind[];
  paymentStatus: 'unpaid' | 'partial' | 'paid';
  createdAt: string;
};

export type SaleReceipt = {
  saleId: string;
  totalMinor: number;
  createdAt: string;
  lines: Array<{
    productId: string;
    name: string;
    sku: string;
    unit: SaleUnit;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  payments: Array<{
    paymentId: string;
    kind: PaymentKind;
    amountMinor: number;
    tenderedMinor: number;
    changeMinor: number;
    paidAt: string;
  }>;
};

function uuidInput(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    throw new BadRequestException('Provide a valid sale ID');
  }
  return value.trim();
}

function searchInput(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > 80) {
    throw new BadRequestException('Invalid sale search');
  }
  return value.trim();
}

function dateInput(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must be in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be in YYYY-MM-DD format`);
  }
  return value;
}

function rangeInput(fromValue: unknown, toValue: unknown) {
  const from = dateInput(fromValue, 'Start date');
  const to = dateInput(toValue, 'End date');
  if (from > to) {
    throw new BadRequestException(
      'The sales start date must be before its end date',
    );
  }
  const days =
    Math.floor(
      (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) /
        86_400_000,
    ) + 1;
  if (days > 93) {
    throw new BadRequestException('Sales history is limited to 93 days');
  }
  return { from, to };
}

function pageInput(value: unknown): number {
  const page = value === undefined ? 0 : Number(value);
  if (!Number.isInteger(page) || page < 0 || page > 200) {
    throw new BadRequestException('Invalid page');
  }
  return page;
}

function safeInteger(value: string | number, field: string): number {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new ServiceUnavailableException(
      `Sales history contains an invalid ${field}.`,
    );
  }
  return number;
}

function paymentStatus(totalMinor: number, paidMinor: number) {
  if (paidMinor <= 0) return 'unpaid' as const;
  if (paidMinor < totalMinor) return 'partial' as const;
  return 'paid' as const;
}

@Injectable()
export class SalesLookupService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async listSales(
    actor: LookupActor,
    searchValue: unknown,
    fromValue: unknown,
    toValue: unknown,
    pageValue: unknown,
  ) {
    const search = searchInput(searchValue);
    const { from, to } = rangeInput(fromValue, toValue);
    const page = pageInput(pageValue);
    try {
      const result = await this.database.connectionPool.query<{
        saleId: string;
        cashierId: string;
        cashierName: string;
        totalMinor: string;
        paidMinor: string;
        refundedMinor: string;
        lineCount: number;
        paymentKinds: PaymentKind[];
        createdAt: string;
      }>(
        `WITH line_totals AS (
          SELECT sale_id, COUNT(*)::int AS line_count
          FROM sale_line GROUP BY sale_id
        ), payment_totals AS (
          SELECT sale_id,
            COALESCE(SUM(amount_minor) FILTER (WHERE status = 'paid'), 0)::bigint AS paid_minor,
            COALESCE(array_agg(DISTINCT kind ORDER BY kind)
              FILTER (WHERE status = 'paid'), ARRAY[]::text[]) AS payment_kinds
          FROM sale_payment GROUP BY sale_id
        ), refund_totals AS (
          SELECT sale_id,
            COALESCE(SUM(amount_minor) FILTER (WHERE status = 'paid'), 0)::bigint AS refunded_minor
          FROM sale_refund GROUP BY sale_id
        )
        SELECT sale.id AS "saleId", sale.actor_id AS "cashierId",
          staff.name AS "cashierName", sale.total_minor::text AS "totalMinor",
          COALESCE(payments.paid_minor, 0)::text AS "paidMinor",
          COALESCE(refunds.refunded_minor, 0)::text AS "refundedMinor",
          COALESCE(lines.line_count, 0)::int AS "lineCount",
          COALESCE(payments.payment_kinds, ARRAY[]::text[]) AS "paymentKinds",
          sale.created_at AS "createdAt"
        FROM sale
        JOIN "user" staff ON staff.id = sale.actor_id
        LEFT JOIN line_totals lines ON lines.sale_id = sale.id
        LEFT JOIN payment_totals payments ON payments.sale_id = sale.id
        LEFT JOIN refund_totals refunds ON refunds.sale_id = sale.id
        WHERE sale.status = 'completed'
          AND ($1 = '' OR strpos(lower(sale.id::text), lower($1)) > 0
            OR strpos(lower(staff.name), lower($1)) > 0)
          AND sale.created_at >= ($2::date::timestamp AT TIME ZONE 'Africa/Nairobi')
          AND sale.created_at < (($3::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')
          AND ($4::boolean OR sale.actor_id = $5)
        ORDER BY sale.created_at DESC, sale.id DESC
        LIMIT 26 OFFSET $6`,
        [search, from, to, actor.role === 'manager', actor.userId, page * 25],
      );
      return {
        sales: result.rows.slice(0, 25).map((row) => {
          const totalMinor = safeInteger(row.totalMinor, 'sale total');
          const paidMinor = safeInteger(row.paidMinor, 'paid total');
          const refundedMinor = safeInteger(
            row.refundedMinor,
            'refunded total',
          );
          return {
            saleId: row.saleId,
            cashierId: row.cashierId,
            cashierName: row.cashierName,
            totalMinor,
            paidMinor,
            refundedMinor,
            balanceMinor: Math.max(totalMinor - paidMinor, 0),
            lineCount: safeInteger(row.lineCount, 'line count'),
            paymentKinds: row.paymentKinds,
            paymentStatus: paymentStatus(totalMinor, paidMinor),
            createdAt: row.createdAt,
          } satisfies SaleLedgerItem;
        }),
        hasMore: result.rows.length > 25,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Sales history is temporarily unavailable.',
      );
    }
  }

  async detail(actor: LookupActor, saleIdValue: string) {
    const saleId = uuidInput(saleIdValue);
    try {
      const saleResult = await this.database.connectionPool.query<{
        saleId: string;
        cashierId: string;
        cashierName: string;
        totalMinor: string;
        status: string;
        paidMinor: string;
        refundedMinor: string;
        createdAt: string;
      }>(
        `SELECT sale.id AS "saleId", sale.actor_id AS "cashierId",
          staff.name AS "cashierName", sale.total_minor::text AS "totalMinor",
          sale.status,
          COALESCE((SELECT SUM(amount_minor) FROM sale_payment
            WHERE sale_id = sale.id AND status = 'paid'), 0)::text AS "paidMinor",
          COALESCE((SELECT SUM(amount_minor) FROM sale_refund
            WHERE sale_id = sale.id AND status = 'paid'), 0)::text AS "refundedMinor",
          sale.created_at AS "createdAt"
        FROM sale JOIN "user" staff ON staff.id = sale.actor_id
        WHERE sale.id = $1 AND ($2::boolean OR sale.actor_id = $3)`,
        [saleId, actor.role === 'manager', actor.userId],
      );
      const sale = saleResult.rows[0];
      if (!sale || sale.status !== 'completed') {
        throw new NotFoundException('Completed sale not found');
      }
      const [linesResult, paymentsResult] = await Promise.all([
        this.database.connectionPool.query<{
          productId: string;
          name: string;
          sku: string;
          unit: SaleUnit;
          quantityMinor: string;
          unitPriceMinor: string;
          lineTotalMinor: string;
        }>(
          `SELECT sl.product_id AS "productId", p.name, p.sku, p.unit,
          sl.quantity_minor::text AS "quantityMinor",
          sl.unit_price_minor::text AS "unitPriceMinor",
          sl.line_total_minor::text AS "lineTotalMinor"
          FROM sale_line sl JOIN catalogue_product p ON p.id = sl.product_id
          WHERE sl.sale_id = $1 ORDER BY sl.created_at ASC`,
          [saleId],
        ),
        this.database.connectionPool.query<{
          paymentId: string;
          kind: PaymentKind;
          amountMinor: string;
          tenderedMinor: string | null;
          paidAt: string;
        }>(
          `SELECT id AS "paymentId", kind, amount_minor::text AS "amountMinor",
          tendered_minor::text AS "tenderedMinor", created_at AS "paidAt"
          FROM sale_payment WHERE sale_id = $1 AND status = 'paid'
          ORDER BY created_at ASC`,
          [saleId],
        ),
      ]);
      const totalMinor = safeInteger(sale.totalMinor, 'sale total');
      const paidMinor = safeInteger(sale.paidMinor, 'paid total');
      const refundedMinor = safeInteger(sale.refundedMinor, 'refunded total');
      return {
        saleId: sale.saleId,
        cashierId: sale.cashierId,
        cashierName: sale.cashierName,
        totalMinor,
        paidMinor,
        refundedMinor,
        balanceMinor: Math.max(totalMinor - paidMinor, 0),
        lineCount: linesResult.rows.length,
        paymentKinds: Array.from(
          new Set(paymentsResult.rows.map((payment) => payment.kind)),
        ),
        paymentStatus: paymentStatus(totalMinor, paidMinor),
        createdAt: sale.createdAt,
        lines: linesResult.rows.map((line) => {
          const quantityMinor = safeInteger(
            line.quantityMinor,
            'line quantity',
          );
          return {
            productId: line.productId,
            name: line.name,
            sku: line.sku,
            unit: line.unit,
            quantity:
              line.unit === 'each' || line.unit === 'pack'
                ? quantityMinor
                : quantityMinor / 1000,
            unitPriceMinor: safeInteger(line.unitPriceMinor, 'line unit price'),
            lineTotalMinor: safeInteger(line.lineTotalMinor, 'line total'),
          };
        }),
        payments: paymentsResult.rows.map((payment) => {
          const amountMinor = safeInteger(
            payment.amountMinor,
            'payment amount',
          );
          const tenderedMinor = safeInteger(
            payment.tenderedMinor ?? payment.amountMinor,
            'payment tender',
          );
          return {
            paymentId: payment.paymentId,
            kind: payment.kind,
            amountMinor,
            tenderedMinor,
            changeMinor: tenderedMinor - amountMinor,
            paidAt: payment.paidAt,
          };
        }),
      };
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Sale details are temporarily unavailable.',
      );
    }
  }

  async receipt(saleIdValue: string) {
    const saleId = uuidInput(saleIdValue);
    try {
      const saleResult = await this.database.connectionPool.query<{
        saleId: string;
        totalMinor: string;
        status: string;
        createdAt: string;
      }>(
        `SELECT id AS "saleId", total_minor::text AS "totalMinor", status,
        created_at AS "createdAt"
        FROM sale WHERE id = $1`,
        [saleId],
      );
      const sale = saleResult.rows[0];
      if (!sale || sale.status !== 'completed') {
        throw new NotFoundException('Completed sale not found');
      }

      const [linesResult, paymentsResult] = await Promise.all([
        this.database.connectionPool.query<{
          productId: string;
          name: string;
          sku: string;
          unit: SaleUnit;
          quantityMinor: string;
          unitPriceMinor: string;
          lineTotalMinor: string;
        }>(
          `SELECT sl.product_id AS "productId", p.name, p.sku, p.unit,
          sl.quantity_minor::text AS "quantityMinor",
          sl.unit_price_minor::text AS "unitPriceMinor",
          sl.line_total_minor::text AS "lineTotalMinor"
          FROM sale_line sl JOIN catalogue_product p ON p.id = sl.product_id
          WHERE sl.sale_id = $1 ORDER BY sl.created_at ASC`,
          [saleId],
        ),
        this.database.connectionPool.query<{
          paymentId: string;
          kind: PaymentKind;
          amountMinor: string;
          tenderedMinor: string | null;
          paidAt: string;
        }>(
          `SELECT id AS "paymentId", kind, amount_minor::text AS "amountMinor",
          tendered_minor::text AS "tenderedMinor",
          created_at AS "paidAt"
          FROM sale_payment WHERE sale_id = $1 AND status = 'paid'
          ORDER BY created_at ASC`,
          [saleId],
        ),
      ]);

      const totalMinor = Number(sale.totalMinor);
      const paidMinor = paymentsResult.rows.reduce(
        (sum, payment) => sum + Number(payment.amountMinor),
        0,
      );
      if (!Number.isSafeInteger(totalMinor) || paidMinor < totalMinor) {
        throw new ConflictException(
          'Payment is not complete; receipt is unavailable',
        );
      }

      return {
        saleId: sale.saleId,
        totalMinor,
        createdAt: sale.createdAt,
        lines: linesResult.rows.map((line) => {
          const quantityMinor = Number(line.quantityMinor);
          return {
            productId: line.productId,
            name: line.name,
            sku: line.sku,
            unit: line.unit,
            quantity:
              line.unit === 'each' || line.unit === 'pack'
                ? quantityMinor
                : quantityMinor / 1000,
            unitPriceMinor: Number(line.unitPriceMinor),
            lineTotalMinor: Number(line.lineTotalMinor),
          };
        }),
        payments: paymentsResult.rows.map((payment) => ({
          paymentId: payment.paymentId,
          kind: payment.kind,
          amountMinor: Number(payment.amountMinor),
          tenderedMinor: Number(payment.tenderedMinor ?? payment.amountMinor),
          changeMinor:
            Number(payment.tenderedMinor ?? payment.amountMinor) -
            Number(payment.amountMinor),
          paidAt: payment.paidAt,
        })),
      } satisfies SaleReceipt;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException ||
        error instanceof ConflictException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'The receipt is temporarily unavailable.',
      );
    }
  }
}
