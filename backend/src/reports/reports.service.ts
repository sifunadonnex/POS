import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

type PurchaseReportRow = {
  receipt_count: string | number;
  received_total_minor: string | number;
  return_count: string | number;
  returned_total_minor: string | number;
  supplier_count: string | number;
};

type SupplierReportRow = {
  supplier_id: string;
  supplier_name: string;
  receipt_count: string | number;
  received_total_minor: string | number;
  return_count: string | number;
  returned_total_minor: string | number;
  last_receipt_at: string | null;
};

type ReceiptReportRow = {
  receipt_id: string;
  supplier_id: string;
  supplier_name: string;
  total_minor: string | number;
  returned_total_minor: string | number;
  reason: string;
  created_at: string;
  line_count: string | number;
};

function safeInteger(value: string | number): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new ServiceUnavailableException(
      'Purchase report contains an unsafe amount.',
    );
  }
  return result;
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  private validateDate(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Date must be in YYYY-MM-DD format');
    }

    const date = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('Date must be in YYYY-MM-DD format');
    }
    return value;
  }

  async summary(day: string) {
    const iso = this.validateDate(day);

    try {
      const saleResult = await this.database.connectionPool.query<{
        sale_count: number;
        sales_total_minor: number;
      }>(
        `SELECT COUNT(*)::int AS sale_count, COALESCE(SUM(total_minor), 0)::bigint AS sales_total_minor
        FROM sale
        WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')`,
        [iso],
      );

      const paymentResult = await this.database.connectionPool.query<{
        cash_minor: number;
        card_minor: number;
        mpesa_minor: number;
        payment_count: number;
      }>(
        `SELECT
          COALESCE(SUM(CASE WHEN kind = 'cash' THEN amount_minor ELSE 0 END), 0)::bigint AS cash_minor,
          COALESCE(SUM(CASE WHEN kind = 'card' THEN amount_minor ELSE 0 END), 0)::bigint AS card_minor,
          COALESCE(SUM(CASE WHEN kind = 'mpesa' THEN amount_minor ELSE 0 END), 0)::bigint AS mpesa_minor,
          COUNT(*)::int AS payment_count
        FROM sale_payment
        WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')`,
        [iso],
      );

      const refundResult = await this.database.connectionPool.query<{
        refund_minor: number;
        refund_count: number;
      }>(
        `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS refund_minor, COUNT(*)::int AS refund_count
        FROM sale_refund
        WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')`,
        [iso],
      );

      const shiftResult = await this.database.connectionPool.query<{
        closed_shift_count: number;
        variance_minor: number;
      }>(
        `SELECT COUNT(*)::int AS closed_shift_count, COALESCE(SUM(variance_minor), 0)::bigint AS variance_minor
        FROM cash_shift
        WHERE closed_at >= $1::date AND closed_at < ($1::date + interval '1 day')`,
        [iso],
      );

      const stockResult = await this.database.connectionPool.query<{
        low_stock_count: number;
      }>(
        `SELECT COUNT(*)::int AS low_stock_count
        FROM inventory_stock
        WHERE quantity_minor <= 1000`,
      );

      const sale = saleResult.rows[0] ?? {
        sale_count: 0,
        sales_total_minor: 0,
      };
      const payment = paymentResult.rows[0] ?? {
        cash_minor: 0,
        card_minor: 0,
        mpesa_minor: 0,
        payment_count: 0,
      };
      const refund = refundResult.rows[0] ?? {
        refund_minor: 0,
        refund_count: 0,
      };
      const shift = shiftResult.rows[0] ?? {
        closed_shift_count: 0,
        variance_minor: 0,
      };
      const stock = stockResult.rows[0] ?? { low_stock_count: 0 };

      return {
        day: iso,
        saleCount: Number(sale.sale_count ?? 0),
        salesTotalMinor: Number(sale.sales_total_minor ?? 0),
        paymentCount: Number(payment.payment_count ?? 0),
        cashMinor: Number(payment.cash_minor ?? 0),
        cardMinor: Number(payment.card_minor ?? 0),
        mpesaMinor: Number(payment.mpesa_minor ?? 0),
        refundCount: Number(refund.refund_count ?? 0),
        refundMinor: Number(refund.refund_minor ?? 0),
        closedShiftCount: Number(shift.closed_shift_count ?? 0),
        varianceMinor: Number(shift.variance_minor ?? 0),
        lowStockCount: Number(stock.low_stock_count ?? 0),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException(
        'Daily sales summary is temporarily unavailable',
      );
    }
  }

  async purchaseReconciliation(fromValue: string, toValue: string) {
    const from = this.validateDate(fromValue);
    const to = this.validateDate(toValue);
    if (from > to) {
      throw new BadRequestException(
        'The report start date must be before its end date',
      );
    }

    try {
      const params = [from, to];
      const summaryResult =
        await this.database.connectionPool.query<PurchaseReportRow>(
          `WITH receipt_totals AS (
          SELECT COUNT(*)::int AS receipt_count,
            COALESCE(SUM(total_minor), 0)::bigint AS received_total_minor
          FROM purchase_receipt
          WHERE status = 'received'
            AND created_at >= $1::date AND created_at < ($2::date + interval '1 day')
        ), return_totals AS (
          SELECT COUNT(*)::int AS return_count,
            COALESCE(SUM(total_minor), 0)::bigint AS returned_total_minor
          FROM purchase_return
          WHERE status = 'returned'
            AND created_at >= $1::date AND created_at < ($2::date + interval '1 day')
        ), supplier_activity AS (
          SELECT supplier_id
          FROM purchase_receipt
          WHERE status = 'received'
            AND created_at >= $1::date AND created_at < ($2::date + interval '1 day')
          UNION
          SELECT receipt.supplier_id
          FROM purchase_return pr
          JOIN purchase_receipt receipt ON receipt.id = pr.receipt_id
          WHERE pr.status = 'returned'
            AND pr.created_at >= $1::date AND pr.created_at < ($2::date + interval '1 day')
        )
        SELECT receipt_count, received_total_minor, return_count,
          returned_total_minor,
          (SELECT COUNT(*)::int FROM supplier_activity) AS supplier_count
        FROM receipt_totals CROSS JOIN return_totals`,
          params,
        );

      const supplierResult =
        await this.database.connectionPool.query<SupplierReportRow>(
          `WITH receipt_totals AS (
          SELECT supplier_id, COUNT(*)::int AS receipt_count,
            COALESCE(SUM(total_minor), 0)::bigint AS received_total_minor,
            MAX(created_at) AS last_receipt_at
          FROM purchase_receipt
          WHERE status = 'received'
            AND created_at >= $1::date AND created_at < ($2::date + interval '1 day')
          GROUP BY supplier_id
        ), return_totals AS (
          SELECT receipt.supplier_id, COUNT(*)::int AS return_count,
            COALESCE(SUM(pr.total_minor), 0)::bigint AS returned_total_minor
          FROM purchase_return pr
          JOIN purchase_receipt receipt ON receipt.id = pr.receipt_id
          WHERE pr.status = 'returned'
            AND pr.created_at >= $1::date AND pr.created_at < ($2::date + interval '1 day')
          GROUP BY receipt.supplier_id
        )
        SELECT s.id AS supplier_id, s.name AS supplier_name,
          COALESCE(receipts.receipt_count, 0)::int AS receipt_count,
          COALESCE(receipts.received_total_minor, 0)::bigint AS received_total_minor,
          COALESCE(returns.return_count, 0)::int AS return_count,
          COALESCE(returns.returned_total_minor, 0)::bigint AS returned_total_minor,
          receipts.last_receipt_at
        FROM supplier s
        LEFT JOIN receipt_totals receipts ON receipts.supplier_id = s.id
        LEFT JOIN return_totals returns ON returns.supplier_id = s.id
        WHERE receipts.supplier_id IS NOT NULL OR returns.supplier_id IS NOT NULL
        ORDER BY lower(s.name), s.id`,
          params,
        );

      const receiptResult =
        await this.database.connectionPool.query<ReceiptReportRow>(
          `SELECT receipt.id AS receipt_id, receipt.supplier_id,
          supplier.name AS supplier_name, receipt.total_minor,
          COALESCE(returns.returned_total_minor, 0)::bigint AS returned_total_minor,
          receipt.reason, receipt.created_at,
          COUNT(line.id)::int AS line_count
        FROM purchase_receipt receipt
        JOIN supplier ON supplier.id = receipt.supplier_id
        LEFT JOIN purchase_receipt_line line ON line.receipt_id = receipt.id
        LEFT JOIN (
          SELECT receipt_id, SUM(total_minor)::bigint AS returned_total_minor
          FROM purchase_return
          WHERE status = 'returned'
          GROUP BY receipt_id
        ) returns ON returns.receipt_id = receipt.id
        WHERE receipt.status = 'received'
          AND receipt.created_at >= $1::date AND receipt.created_at < ($2::date + interval '1 day')
        GROUP BY receipt.id, supplier.name, returns.returned_total_minor
        ORDER BY receipt.created_at DESC, receipt.id DESC`,
          params,
        );

      const summary = summaryResult.rows[0] ?? {
        receipt_count: 0,
        received_total_minor: 0,
        return_count: 0,
        returned_total_minor: 0,
        supplier_count: 0,
      };
      const receivedTotalMinor = safeInteger(summary.received_total_minor);
      const returnedTotalMinor = safeInteger(summary.returned_total_minor);

      return {
        from,
        to,
        summary: {
          receiptCount: safeInteger(summary.receipt_count),
          receivedTotalMinor,
          returnCount: safeInteger(summary.return_count),
          returnedTotalMinor,
          netPurchasesMinor: receivedTotalMinor - returnedTotalMinor,
          supplierCount: safeInteger(summary.supplier_count),
        },
        suppliers: supplierResult.rows.map((row) => {
          const received = safeInteger(row.received_total_minor);
          const returned = safeInteger(row.returned_total_minor);
          return {
            supplierId: row.supplier_id,
            supplierName: row.supplier_name,
            receiptCount: safeInteger(row.receipt_count),
            receivedTotalMinor: received,
            returnCount: safeInteger(row.return_count),
            returnedTotalMinor: returned,
            netPurchasesMinor: received - returned,
            lastReceiptAt: row.last_receipt_at,
          };
        }),
        receipts: receiptResult.rows.map((row) => {
          const total = safeInteger(row.total_minor);
          const returned = safeInteger(row.returned_total_minor);
          return {
            receiptId: row.receipt_id,
            supplierId: row.supplier_id,
            supplierName: row.supplier_name,
            totalMinor: total,
            returnedTotalMinor: returned,
            netTotalMinor: total - returned,
            reason: row.reason,
            createdAt: row.created_at,
            lineCount: safeInteger(row.line_count),
          };
        }),
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Purchase reconciliation is temporarily unavailable',
      );
    }
  }
}
