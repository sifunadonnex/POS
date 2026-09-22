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

@Injectable()
export class SalesLookupService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

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
