import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
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

type SalesSummaryRow = {
  sale_count: string | number;
  gross_sales_minor: string | number;
  refund_count: string | number;
  refund_minor: string | number;
  active_cashier_count: string | number;
};

type DailySalesRow = {
  day: string | Date;
  sale_count: string | number;
  gross_sales_minor: string | number;
  refund_minor: string | number;
};

type CashierSalesRow = {
  cashier_id: string;
  cashier_name: string;
  sale_count: string | number;
  gross_sales_minor: string | number;
  refund_minor: string | number;
};

type PaymentMixRow = {
  kind: 'cash' | 'card' | 'mpesa';
  payment_count: string | number;
  amount_minor: string | number;
};

type ProductSalesRow = {
  product_id: string;
  product_name: string;
  unit: 'each' | 'pack' | 'kg' | 'l';
  quantity_minor: string | number;
  gross_sales_minor: string | number;
  sale_count: string | number;
};

type SalesSource = 'operational' | 'edge' | 'all';

type SalesSourceOption = {
  source: SalesSource;
  storeId: string | null;
  label: string;
};

type SalesInsightsData = {
  summary: {
    saleCount: number;
    grossSalesMinor: number;
    refundCount: number;
    refundMinor: number;
    netSalesMinor: number;
    averageBasketMinor: number;
    activeCashierCount: number;
  };
  daily: Array<{
    day: string;
    saleCount: number;
    grossSalesMinor: number;
    refundMinor: number;
    netSalesMinor: number;
  }>;
  cashiers: Array<{
    cashierId: string;
    cashierName: string;
    source: 'operational' | 'edge';
    storeId: string | null;
    saleCount: number;
    grossSalesMinor: number;
    refundMinor: number;
    netSalesMinor: number;
    averageBasketMinor: number;
  }>;
  paymentMix: Array<{
    kind: 'cash' | 'card' | 'mpesa';
    paymentCount: number;
    amountMinor: number;
  }>;
  topProducts: Array<{
    productId: string;
    productName: string;
    source: 'operational' | 'edge';
    storeId: string | null;
    unit: 'each' | 'pack' | 'kg' | 'l';
    quantityMinor: number;
    grossSalesMinor: number;
    saleCount: number;
  }>;
};

type LowStockRow = {
  product_id: string;
  sku: string;
  product_name: string;
  unit: 'each' | 'pack' | 'kg' | 'l';
  quantity_minor: string | number;
  threshold_minor: string | number;
  low_stock_count: string | number;
};

function safeInteger(value: string | number): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new ServiceUnavailableException('Report contains an unsafe amount.');
  }
  return result;
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  private validateDate(value: string): string {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException('Date must be in YYYY-MM-DD format');
    }

    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      date.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException('Date must be in YYYY-MM-DD format');
    }
    return value;
  }

  private validateRange(
    fromValue: string,
    toValue: string,
    maximumDays?: number,
  ) {
    const from = this.validateDate(fromValue);
    const to = this.validateDate(toValue);
    if (from > to) {
      throw new BadRequestException(
        'The report start date must be before its end date',
      );
    }
    const days =
      Math.round(
        (Date.parse(`${to}T00:00:00.000Z`) -
          Date.parse(`${from}T00:00:00.000Z`)) /
          86_400_000,
      ) + 1;
    if (maximumDays && days > maximumDays) {
      throw new BadRequestException(
        `The report period may not exceed ${maximumDays} days`,
      );
    }
    return { from, to, days };
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

      const stockResult = await this.database.connectionPool.query<LowStockRow>(
        `SELECT p.id AS product_id, p.sku, p.name AS product_name, p.unit,
          COALESCE(stock.quantity_minor, 0)::bigint AS quantity_minor,
          p.low_stock_threshold_minor::bigint AS threshold_minor,
          COUNT(*) OVER()::int AS low_stock_count
          FROM catalogue_product p
          LEFT JOIN inventory_stock stock ON stock.product_id = p.id
          WHERE p.active AND p.low_stock_threshold_minor IS NOT NULL
            AND COALESCE(stock.quantity_minor, 0) <= p.low_stock_threshold_minor
          ORDER BY (COALESCE(stock.quantity_minor, 0) = 0) DESC,
            (p.low_stock_threshold_minor - COALESCE(stock.quantity_minor, 0)) DESC,
            lower(p.name), p.id
          LIMIT 5`,
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
      const lowStockCount = stockResult.rows[0]
        ? safeInteger(stockResult.rows[0].low_stock_count)
        : 0;

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
        lowStockCount,
        lowStockItems: stockResult.rows.map((row) => ({
          productId: row.product_id,
          sku: row.sku,
          name: row.product_name,
          unit: row.unit,
          quantityMinor: safeInteger(row.quantity_minor),
          thresholdMinor: safeInteger(row.threshold_minor),
        })),
      };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new ServiceUnavailableException(
        'Daily sales summary is temporarily unavailable',
      );
    }
  }

  async purchaseReconciliation(fromValue: string, toValue: string) {
    const { from, to } = this.validateRange(fromValue, toValue);

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

      const edgeStoreId =
        this.config.runtime.mode === 'hosted'
          ? this.config.sync?.storeId
          : undefined;
      const edgeDocuments = edgeStoreId
        ? await this.database.connectionPool.query<{
            document_id: string;
            event_type:
              'purchase_receipt.received' | 'purchase_return.returned';
            supplier_id: string;
            supplier_name: string;
            receipt_id: string | null;
            total_minor: string;
            reason: string;
            occurred_at: string;
            line_count: number;
          }>(
            `SELECT document_id,event_type,supplier_id,supplier_name,receipt_id,
              total_minor::text,reason,occurred_at::text,
              jsonb_array_length(lines) AS line_count
             FROM sync_operation_document_projection
             WHERE store_id = $1 AND event_type IN
               ('purchase_receipt.received','purchase_return.returned')
               AND (occurred_at AT TIME ZONE 'Africa/Nairobi')::date
                 BETWEEN $2::date AND $3::date`,
            [edgeStoreId, from, to],
          )
        : {
            rows: [] as Array<{
              document_id: string;
              event_type: string;
              supplier_id: string;
              supplier_name: string;
              receipt_id: string | null;
              total_minor: string;
              reason: string;
              occurred_at: string;
              line_count: number;
            }>,
          };
      const edgeReceipts = edgeDocuments.rows.filter(
        (row) => row.event_type === 'purchase_receipt.received',
      );
      const edgeReturns = edgeDocuments.rows.filter(
        (row) => row.event_type === 'purchase_return.returned',
      );
      const returnedForReceipts =
        edgeStoreId && edgeReceipts.length
          ? await this.database.connectionPool.query<{
              receipt_id: string;
              returned_minor: string;
            }>(
              `SELECT receipt_id, SUM(total_minor)::text AS returned_minor
             FROM sync_operation_document_projection
             WHERE store_id = $1 AND event_type = 'purchase_return.returned'
               AND receipt_id = ANY($2::uuid[]) GROUP BY receipt_id`,
              [edgeStoreId, edgeReceipts.map((row) => row.document_id)],
            )
          : {
              rows: [] as Array<{ receipt_id: string; returned_minor: string }>,
            };
      const returnedByReceipt = new Map(
        returnedForReceipts.rows.map((row) => [
          row.receipt_id,
          safeInteger(row.returned_minor),
        ]),
      );
      const edgeSuppliers = new Map<
        string,
        {
          supplierId: string;
          supplierName: string;
          source: 'edge';
          storeId: string;
          receiptCount: number;
          receivedTotalMinor: number;
          returnCount: number;
          returnedTotalMinor: number;
          netPurchasesMinor: number;
          lastReceiptAt: string | null;
        }
      >();
      for (const row of edgeDocuments.rows) {
        const key = row.supplier_id;
        let supplier = edgeSuppliers.get(key);
        if (!supplier) {
          supplier = {
            supplierId: key,
            supplierName: row.supplier_name,
            source: 'edge',
            storeId: edgeStoreId!,
            receiptCount: 0,
            receivedTotalMinor: 0,
            returnCount: 0,
            returnedTotalMinor: 0,
            netPurchasesMinor: 0,
            lastReceiptAt: null,
          };
          edgeSuppliers.set(key, supplier);
        }
        const amount = safeInteger(row.total_minor);
        if (row.event_type === 'purchase_receipt.received') {
          supplier.receiptCount++;
          supplier.receivedTotalMinor = safeInteger(
            supplier.receivedTotalMinor + amount,
          );
          if (
            !supplier.lastReceiptAt ||
            row.occurred_at > supplier.lastReceiptAt
          )
            supplier.lastReceiptAt = row.occurred_at;
        } else {
          supplier.returnCount++;
          supplier.returnedTotalMinor = safeInteger(
            supplier.returnedTotalMinor + amount,
          );
        }
        supplier.netPurchasesMinor = safeInteger(
          supplier.receivedTotalMinor - supplier.returnedTotalMinor,
        );
      }
      const edgeReceived = edgeReceipts.reduce(
        (sum, row) => sum + safeInteger(row.total_minor),
        0,
      );
      const edgeReturned = edgeReturns.reduce(
        (sum, row) => sum + safeInteger(row.total_minor),
        0,
      );
      const allReceived = safeInteger(receivedTotalMinor + edgeReceived);
      const allReturned = safeInteger(returnedTotalMinor + edgeReturned);
      const supplierCount = new Set([
        ...supplierResult.rows.map((row) => row.supplier_id),
        ...edgeSuppliers.keys(),
      ]).size;

      return {
        from,
        to,
        reportingLag: await this.reportingLag(),
        summary: {
          receiptCount:
            safeInteger(summary.receipt_count) + edgeReceipts.length,
          receivedTotalMinor: allReceived,
          returnCount: safeInteger(summary.return_count) + edgeReturns.length,
          returnedTotalMinor: allReturned,
          netPurchasesMinor: safeInteger(allReceived - allReturned),
          supplierCount,
        },
        suppliers: [
          ...supplierResult.rows.map((row) => {
            const received = safeInteger(row.received_total_minor);
            const returned = safeInteger(row.returned_total_minor);
            return {
              supplierId: row.supplier_id,
              supplierName: row.supplier_name,
              source: 'operational' as const,
              storeId: null,
              receiptCount: safeInteger(row.receipt_count),
              receivedTotalMinor: received,
              returnCount: safeInteger(row.return_count),
              returnedTotalMinor: returned,
              netPurchasesMinor: received - returned,
              lastReceiptAt: row.last_receipt_at,
            };
          }),
          ...edgeSuppliers.values(),
        ],
        receipts: [
          ...receiptResult.rows.map((row) => {
            const total = safeInteger(row.total_minor);
            const returned = safeInteger(row.returned_total_minor);
            return {
              receiptId: row.receipt_id,
              supplierId: row.supplier_id,
              supplierName: row.supplier_name,
              source: 'operational' as const,
              storeId: null,
              totalMinor: total,
              returnedTotalMinor: returned,
              netTotalMinor: total - returned,
              reason: row.reason,
              createdAt: row.created_at,
              lineCount: safeInteger(row.line_count),
            };
          }),
          ...edgeReceipts.map((row) => {
            const total = safeInteger(row.total_minor);
            const returned = returnedByReceipt.get(row.document_id) ?? 0;
            return {
              receiptId: row.document_id,
              supplierId: row.supplier_id,
              supplierName: row.supplier_name,
              source: 'edge' as const,
              storeId: edgeStoreId!,
              totalMinor: total,
              returnedTotalMinor: returned,
              netTotalMinor: total - returned,
              reason: row.reason,
              createdAt: row.occurred_at,
              lineCount: row.line_count,
            };
          }),
        ],
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

  private resolveSalesSource(
    sourceValue?: string,
    storeId?: string,
  ): { selected: SalesSourceOption; available: SalesSourceOption[] } {
    const operational: SalesSourceOption = {
      source: 'operational',
      storeId: null,
      label:
        this.config.runtime.mode === 'edge'
          ? 'This register'
          : 'Hosted operations',
    };
    const edgeStore =
      this.config.runtime.mode === 'hosted' && this.config.sync
        ? ({
            source: 'edge',
            storeId: this.config.sync.storeId,
            label: `Synchronized store · ${this.config.sync.storeId.slice(0, 8)}`,
          } satisfies SalesSourceOption)
        : null;
    const available: SalesSourceOption[] = edgeStore
      ? [
          { source: 'all', storeId: null, label: 'All sales sources' },
          operational,
          edgeStore,
        ]
      : [operational];
    const source = sourceValue ?? (edgeStore ? 'all' : 'operational');
    if (source !== 'all' && source !== 'operational' && source !== 'edge') {
      throw new BadRequestException('Invalid sales report source');
    }
    if (source === 'edge') {
      if (!edgeStore || storeId !== edgeStore.storeId) {
        throw new BadRequestException('Invalid synchronized store');
      }
      return { selected: edgeStore, available };
    }
    if (storeId) {
      throw new BadRequestException(
        'A store ID is only valid for a synchronized store report',
      );
    }
    const selected = available.find((option) => option.source === source);
    if (!selected) {
      throw new BadRequestException('Invalid sales report source');
    }
    return { selected, available };
  }

  private async operationalSalesInsights(
    from: string,
    to: string,
  ): Promise<SalesInsightsData> {
    const params = [from, to];
    const period = (alias?: string) => {
      const column = alias ? `${alias}.created_at` : 'created_at';
      return `${column} >= ($1::date::timestamp AT TIME ZONE 'Africa/Nairobi')
        AND ${column} < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')`;
    };
    const [
      summaryResult,
      dailyResult,
      cashierResult,
      paymentResult,
      productResult,
    ] = await Promise.all([
      this.database.connectionPool.query<SalesSummaryRow>(
        `WITH sales AS (
            SELECT COUNT(*)::int AS sale_count,
              COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor,
              COUNT(DISTINCT actor_id)::int AS active_cashier_count
            FROM sale
            WHERE status = 'completed' AND ${period()}
          ), refunds AS (
            SELECT COUNT(*)::int AS refund_count,
              COALESCE(SUM(amount_minor), 0)::bigint AS refund_minor
            FROM sale_refund
            WHERE status = 'paid' AND ${period()}
          )
          SELECT sale_count, gross_sales_minor, active_cashier_count,
            refund_count, refund_minor
          FROM sales CROSS JOIN refunds`,
        params,
      ),
      this.database.connectionPool.query<DailySalesRow>(
        `WITH calendar AS (
            SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
          ), sales AS (
            SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date AS day,
              COUNT(*)::int AS sale_count,
              COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor
            FROM sale
            WHERE status = 'completed' AND ${period()}
            GROUP BY 1
          ), refunds AS (
            SELECT (created_at AT TIME ZONE 'Africa/Nairobi')::date AS day,
              COALESCE(SUM(amount_minor), 0)::bigint AS refund_minor
            FROM sale_refund
            WHERE status = 'paid' AND ${period()}
            GROUP BY 1
          )
          SELECT calendar.day::text AS day,
            COALESCE(sales.sale_count, 0)::int AS sale_count,
            COALESCE(sales.gross_sales_minor, 0)::bigint AS gross_sales_minor,
            COALESCE(refunds.refund_minor, 0)::bigint AS refund_minor
          FROM calendar
          LEFT JOIN sales USING (day)
          LEFT JOIN refunds USING (day)
          ORDER BY calendar.day`,
        params,
      ),
      this.database.connectionPool.query<CashierSalesRow>(
        `WITH sales_by_actor AS (
            SELECT actor_id, COUNT(*)::int AS sale_count,
              COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor
            FROM sale
            WHERE status = 'completed' AND ${period()}
            GROUP BY actor_id
          ), refunds_by_actor AS (
            SELECT sale.actor_id,
              COALESCE(SUM(refund.amount_minor), 0)::bigint AS refund_minor
            FROM sale_refund refund
            JOIN sale ON sale.id = refund.sale_id
            WHERE refund.status = 'paid' AND ${period('refund')}
            GROUP BY sale.actor_id
          ), activity AS (
            SELECT actor_id FROM sales_by_actor
            UNION
            SELECT actor_id FROM refunds_by_actor
          )
          SELECT staff.id AS cashier_id, staff.name AS cashier_name,
            COALESCE(sales.sale_count, 0)::int AS sale_count,
            COALESCE(sales.gross_sales_minor, 0)::bigint AS gross_sales_minor,
            COALESCE(refunds.refund_minor, 0)::bigint AS refund_minor
          FROM activity
          JOIN "user" staff ON staff.id = activity.actor_id
          LEFT JOIN sales_by_actor sales ON sales.actor_id = activity.actor_id
          LEFT JOIN refunds_by_actor refunds ON refunds.actor_id = activity.actor_id
          ORDER BY (COALESCE(sales.gross_sales_minor, 0) -
            COALESCE(refunds.refund_minor, 0)) DESC, lower(staff.name), staff.id`,
        params,
      ),
      this.database.connectionPool.query<PaymentMixRow>(
        `SELECT kind, COUNT(*)::int AS payment_count,
            COALESCE(SUM(amount_minor), 0)::bigint AS amount_minor
          FROM sale_payment
          WHERE status = 'paid' AND ${period()}
          GROUP BY kind
          ORDER BY CASE kind WHEN 'cash' THEN 1 WHEN 'card' THEN 2 ELSE 3 END`,
        params,
      ),
      this.database.connectionPool.query<ProductSalesRow>(
        `SELECT product.id AS product_id, product.name AS product_name,
            product.unit, SUM(line.quantity_minor)::bigint AS quantity_minor,
            SUM(line.line_total_minor)::bigint AS gross_sales_minor,
            COUNT(DISTINCT sale.id)::int AS sale_count
          FROM sale_line line
          JOIN sale ON sale.id = line.sale_id
          JOIN catalogue_product product ON product.id = line.product_id
          WHERE sale.status = 'completed' AND ${period('sale')}
          GROUP BY product.id, product.name, product.unit
          ORDER BY gross_sales_minor DESC, lower(product.name), product.id
          LIMIT 8`,
        params,
      ),
    ]);
    return this.mapSalesData(
      summaryResult.rows[0],
      dailyResult.rows,
      cashierResult.rows,
      paymentResult.rows,
      productResult.rows,
      'operational',
      null,
    );
  }

  private async edgeSalesInsights(
    from: string,
    to: string,
    storeId: string,
  ): Promise<SalesInsightsData> {
    const params = [from, to, storeId];
    const period = (alias = 'sale') =>
      `${alias}.occurred_at >= ($1::date::timestamp AT TIME ZONE 'Africa/Nairobi')
      AND ${alias}.occurred_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Nairobi')`;
    const [
      summaryResult,
      dailyResult,
      cashierResult,
      paymentResult,
      productResult,
    ] = await Promise.all([
      this.database.connectionPool.query<SalesSummaryRow>(
        `WITH sales AS (
          SELECT COUNT(*)::int AS sale_count,
            COALESCE(SUM(total_minor), 0)::bigint AS gross_sales_minor,
            COUNT(DISTINCT cashier_id)::int AS active_cashier_count
          FROM sync_cash_sale_projection sale
          WHERE store_id = $3 AND ${period()}
        ), refunds AS (
          SELECT COUNT(*)::int AS refund_count,
            COALESCE(SUM(amount_minor), 0)::bigint AS refund_minor
          FROM sync_refund_projection refund
          WHERE store_id = $3 AND ${period('refund')}
        )
        SELECT * FROM sales CROSS JOIN refunds`,
        params,
      ),
      this.database.connectionPool.query<DailySalesRow>(
        `WITH calendar AS (
            SELECT generate_series($1::date, $2::date, interval '1 day')::date AS day
          ), sales AS (
            SELECT (sale.occurred_at AT TIME ZONE 'Africa/Nairobi')::date AS day,
              COUNT(*)::int AS sale_count,
              COALESCE(SUM(sale.total_minor), 0)::bigint AS gross_sales_minor
            FROM sync_cash_sale_projection sale
            WHERE sale.store_id = $3 AND ${period()}
            GROUP BY 1
          ), refunds AS (
            SELECT (refund.occurred_at AT TIME ZONE 'Africa/Nairobi')::date AS day,
              COALESCE(SUM(refund.amount_minor), 0)::bigint AS refund_minor
            FROM sync_refund_projection refund
            WHERE refund.store_id = $3 AND ${period('refund')}
            GROUP BY 1
          )
          SELECT calendar.day::text AS day,
            COALESCE(sales.sale_count, 0)::int AS sale_count,
            COALESCE(sales.gross_sales_minor, 0)::bigint AS gross_sales_minor,
            COALESCE(refunds.refund_minor, 0)::bigint AS refund_minor
          FROM calendar LEFT JOIN sales USING (day)
          LEFT JOIN refunds USING (day)
          ORDER BY calendar.day`,
        params,
      ),
      this.database.connectionPool.query<CashierSalesRow>(
        `WITH sales AS (
          SELECT sale.cashier_id,
            (array_agg(sale.cashier_name ORDER BY sale.occurred_at DESC))[1]
              AS cashier_name,
            COUNT(*)::int AS sale_count,
            COALESCE(SUM(sale.total_minor), 0)::bigint AS gross_sales_minor
          FROM sync_cash_sale_projection sale
          WHERE sale.store_id = $3 AND ${period()}
          GROUP BY sale.cashier_id
        ), refunds AS (
          SELECT refund.cashier_id,
            (array_agg(refund.cashier_name ORDER BY refund.occurred_at DESC))[1]
              AS cashier_name,
            COALESCE(SUM(refund.amount_minor), 0)::bigint AS refund_minor
          FROM sync_refund_projection refund
          WHERE refund.store_id = $3 AND ${period('refund')}
          GROUP BY refund.cashier_id
        ), activity AS (
          SELECT cashier_id FROM sales UNION SELECT cashier_id FROM refunds
        )
        SELECT activity.cashier_id,
          COALESCE(sales.cashier_name, refunds.cashier_name) AS cashier_name,
          COALESCE(sales.sale_count, 0)::int AS sale_count,
          COALESCE(sales.gross_sales_minor, 0)::bigint AS gross_sales_minor,
          COALESCE(refunds.refund_minor, 0)::bigint AS refund_minor
        FROM activity
        LEFT JOIN sales USING (cashier_id)
        LEFT JOIN refunds USING (cashier_id)
        ORDER BY (COALESCE(sales.gross_sales_minor, 0) -
          COALESCE(refunds.refund_minor, 0)) DESC,
          lower(COALESCE(sales.cashier_name, refunds.cashier_name)),
          activity.cashier_id`,
        params,
      ),
      this.database.connectionPool.query<PaymentMixRow>(
        `SELECT 'cash'::text AS kind, COUNT(*)::int AS payment_count,
          COALESCE(SUM(sale.total_minor), 0)::bigint AS amount_minor
        FROM sync_cash_sale_projection sale
        WHERE sale.store_id = $3 AND ${period()}
        HAVING COUNT(*) > 0`,
        params,
      ),
      this.database.connectionPool.query<ProductSalesRow>(
        `SELECT line.product_id,
          (array_agg(line.product_name ORDER BY sale.occurred_at DESC))[1] AS product_name,
          line.unit, SUM(line.quantity_minor)::bigint AS quantity_minor,
          SUM(line.line_total_minor)::bigint AS gross_sales_minor,
          COUNT(DISTINCT sale.sale_id)::int AS sale_count
        FROM sync_cash_sale_line_projection line
        JOIN sync_cash_sale_projection sale ON sale.event_id = line.event_id
        WHERE sale.store_id = $3 AND ${period()}
        GROUP BY line.product_id, line.unit
        ORDER BY gross_sales_minor DESC, lower((array_agg(line.product_name
          ORDER BY sale.occurred_at DESC))[1]), line.product_id
        LIMIT 8`,
        params,
      ),
    ]);
    return this.mapSalesData(
      summaryResult.rows[0],
      dailyResult.rows,
      cashierResult.rows,
      paymentResult.rows,
      productResult.rows,
      'edge',
      storeId,
    );
  }

  private mapSalesData(
    summaryRow: SalesSummaryRow | undefined,
    dailyRows: DailySalesRow[],
    cashierRows: CashierSalesRow[],
    paymentRows: PaymentMixRow[],
    productRows: ProductSalesRow[],
    source: 'operational' | 'edge',
    storeId: string | null,
  ): SalesInsightsData {
    const summary = summaryRow ?? {
      sale_count: 0,
      gross_sales_minor: 0,
      refund_count: 0,
      refund_minor: 0,
      active_cashier_count: 0,
    };
    const saleCount = safeInteger(summary.sale_count);
    const grossSalesMinor = safeInteger(summary.gross_sales_minor);
    const refundMinor = safeInteger(summary.refund_minor);
    return {
      summary: {
        saleCount,
        grossSalesMinor,
        refundCount: safeInteger(summary.refund_count),
        refundMinor,
        netSalesMinor: grossSalesMinor - refundMinor,
        averageBasketMinor: saleCount
          ? Math.round(grossSalesMinor / saleCount)
          : 0,
        activeCashierCount: safeInteger(summary.active_cashier_count),
      },
      daily: dailyRows.map((row) => {
        const gross = safeInteger(row.gross_sales_minor);
        const refunded = safeInteger(row.refund_minor);
        return {
          day:
            row.day instanceof Date
              ? row.day.toISOString().slice(0, 10)
              : row.day,
          saleCount: safeInteger(row.sale_count),
          grossSalesMinor: gross,
          refundMinor: refunded,
          netSalesMinor: gross - refunded,
        };
      }),
      cashiers: cashierRows.map((row) => {
        const count = safeInteger(row.sale_count);
        const gross = safeInteger(row.gross_sales_minor);
        const refunded = safeInteger(row.refund_minor);
        return {
          cashierId: row.cashier_id,
          cashierName: row.cashier_name,
          source,
          storeId,
          saleCount: count,
          grossSalesMinor: gross,
          refundMinor: refunded,
          netSalesMinor: gross - refunded,
          averageBasketMinor: count ? Math.round(gross / count) : 0,
        };
      }),
      paymentMix: paymentRows.map((row) => ({
        kind: row.kind,
        paymentCount: safeInteger(row.payment_count),
        amountMinor: safeInteger(row.amount_minor),
      })),
      topProducts: productRows.map((row) => ({
        productId: row.product_id,
        productName: row.product_name,
        source,
        storeId,
        unit: row.unit,
        quantityMinor: safeInteger(row.quantity_minor),
        grossSalesMinor: safeInteger(row.gross_sales_minor),
        saleCount: safeInteger(row.sale_count),
      })),
    };
  }

  private mergeSalesData(
    operational: SalesInsightsData,
    edge: SalesInsightsData,
  ): SalesInsightsData {
    const saleCount = operational.summary.saleCount + edge.summary.saleCount;
    const grossSalesMinor =
      operational.summary.grossSalesMinor + edge.summary.grossSalesMinor;
    const refundCount =
      operational.summary.refundCount + edge.summary.refundCount;
    const refundMinor =
      operational.summary.refundMinor + edge.summary.refundMinor;
    const edgeDays = new Map(edge.daily.map((row) => [row.day, row]));
    const paymentMix = (['cash', 'card', 'mpesa'] as const)
      .map((kind) => {
        const rows = [...operational.paymentMix, ...edge.paymentMix].filter(
          (row) => row.kind === kind,
        );
        return {
          kind,
          paymentCount: rows.reduce(
            (total, row) => total + row.paymentCount,
            0,
          ),
          amountMinor: rows.reduce((total, row) => total + row.amountMinor, 0),
        };
      })
      .filter((row) => row.paymentCount > 0 || row.amountMinor > 0);
    const cashiers = [...operational.cashiers, ...edge.cashiers].sort(
      (left, right) =>
        right.netSalesMinor - left.netSalesMinor ||
        left.cashierName.localeCompare(right.cashierName),
    );
    return {
      summary: {
        saleCount,
        grossSalesMinor,
        refundCount,
        refundMinor,
        netSalesMinor: grossSalesMinor - refundMinor,
        averageBasketMinor: saleCount
          ? Math.round(grossSalesMinor / saleCount)
          : 0,
        activeCashierCount: cashiers.filter((cashier) => cashier.saleCount > 0)
          .length,
      },
      daily: operational.daily.map((row) => {
        const addition = edgeDays.get(row.day);
        const gross = row.grossSalesMinor + (addition?.grossSalesMinor ?? 0);
        const refunded = row.refundMinor + (addition?.refundMinor ?? 0);
        return {
          day: row.day,
          saleCount: row.saleCount + (addition?.saleCount ?? 0),
          grossSalesMinor: gross,
          refundMinor: refunded,
          netSalesMinor: gross - refunded,
        };
      }),
      cashiers,
      paymentMix,
      topProducts: [...operational.topProducts, ...edge.topProducts]
        .sort(
          (left, right) =>
            right.grossSalesMinor - left.grossSalesMinor ||
            left.productName.localeCompare(right.productName),
        )
        .slice(0, 8),
    };
  }

  private async reportingLag() {
    const { runtime, sync } = this.config;
    if (!sync) {
      return {
        status: 'not_configured' as const,
        pendingEvents: 0,
        receivedEvents: 0,
        projectedEvents: 0,
        latestReceivedAt: null,
      };
    }
    if (runtime.mode === 'edge') {
      const result = await this.database.connectionPool.query<{
        pending_events: string | number;
      }>(
        `SELECT COUNT(*) FILTER (WHERE delivered_at IS NULL)::int AS pending_events
        FROM sync_outbox WHERE store_id = $1`,
        [runtime.storeId],
      );
      const pendingEvents = safeInteger(result.rows[0]?.pending_events ?? 0);
      return {
        status: pendingEvents ? ('lagging' as const) : ('current' as const),
        pendingEvents,
        receivedEvents: 0,
        projectedEvents: 0,
        latestReceivedAt: null,
      };
    }
    const result = await this.database.connectionPool.query<{
      received_events: string | number;
      projected_events: string | number;
      latest_received_at: string | null;
    }>(
      `SELECT COUNT(i.id)::int AS received_events,
        (COUNT(p.event_id) + COUNT(r.event_id) + COUNT(m.event_id)
          + COUNT(d.event_id))::int
          AS projected_events,
        MAX(i.received_at)::text AS latest_received_at
      FROM sync_inbox i
      LEFT JOIN sync_cash_sale_projection p ON p.event_id = i.id
      LEFT JOIN sync_refund_projection r ON r.event_id = i.id
      LEFT JOIN sync_stock_movement_projection m ON m.event_id = i.id
      LEFT JOIN sync_operation_document_projection d ON d.event_id = i.id
      WHERE i.store_id = $1`,
      [sync.storeId],
    );
    const receivedEvents = safeInteger(result.rows[0]?.received_events ?? 0);
    const projectedEvents = safeInteger(result.rows[0]?.projected_events ?? 0);
    return {
      status:
        receivedEvents === projectedEvents
          ? ('current' as const)
          : ('lagging' as const),
      pendingEvents: 0,
      receivedEvents,
      projectedEvents,
      latestReceivedAt: result.rows[0]?.latest_received_at ?? null,
    };
  }

  async salesInsights(
    fromValue: string,
    toValue: string,
    sourceValue?: string,
    storeId?: string,
  ) {
    const { from, to, days } = this.validateRange(fromValue, toValue, 93);
    const sources = this.resolveSalesSource(sourceValue, storeId);
    try {
      const operationalPromise =
        sources.selected.source === 'edge'
          ? null
          : this.operationalSalesInsights(from, to);
      const edgePromise =
        sources.selected.source === 'operational'
          ? null
          : this.edgeSalesInsights(from, to, this.config.sync?.storeId ?? '');
      const [operational, edge, lag] = await Promise.all([
        operationalPromise,
        edgePromise,
        this.reportingLag(),
      ]);
      const data = operational
        ? edge
          ? this.mergeSalesData(operational, edge)
          : operational
        : edge;
      if (!data) {
        throw new ServiceUnavailableException(
          'Sales insights are temporarily unavailable',
        );
      }
      return {
        from,
        to,
        days,
        scope: sources.selected,
        availableSources: sources.available,
        reportingLag: lag,
        coverage: {
          synchronizedReturns:
            sources.selected.source === 'operational'
              ? ('not_applicable' as const)
              : ('available' as const),
        },
        ...data,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Sales insights are temporarily unavailable',
      );
    }
  }

  async stockPosition() {
    const state = await this.database.connectionPool.query<{
      store_id: string;
      checkout_authority: 'hosted' | 'local';
      runtime_mode: 'hosted' | 'edge';
    }>(
      'SELECT store_id, checkout_authority, runtime_mode FROM store_bootstrap_state WHERE singleton',
    );
    const edgeSource =
      this.config.runtime.mode === 'hosted' &&
      state.rows[0]?.runtime_mode === 'hosted' &&
      state.rows[0]?.checkout_authority === 'local';
    if (
      edgeSource &&
      (!this.config.sync || state.rows[0].store_id !== this.config.sync.storeId)
    )
      throw new ServiceUnavailableException(
        'Store synchronization is unavailable',
      );
    const storeId = edgeSource ? (this.config.sync?.storeId ?? null) : null;
    const rows = edgeSource
      ? await this.database.connectionPool.query<{
          product_id: string;
          sku: string;
          product_name: string;
          unit: 'each' | 'pack' | 'kg' | 'l';
          quantity_minor: string;
          movement_count: string;
        }>(
          `SELECT p.id AS product_id, p.sku, p.name AS product_name,
            p.unit, COALESCE(SUM(m.delta_minor), 0)::text AS quantity_minor,
            COUNT(m.event_id)::text AS movement_count
          FROM catalogue_product p
          LEFT JOIN sync_stock_movement_projection m
            ON m.product_id = p.id AND m.store_id = $1
          GROUP BY p.id, p.sku, p.name, p.unit
          ORDER BY lower(p.name), p.id`,
          [storeId],
        )
      : await this.database.connectionPool.query<{
          product_id: string;
          sku: string;
          product_name: string;
          unit: 'each' | 'pack' | 'kg' | 'l';
          quantity_minor: string;
          movement_count: string;
        }>(
          `SELECT p.id AS product_id, p.sku, p.name AS product_name,
            p.unit, COALESCE(s.quantity_minor, 0)::text AS quantity_minor,
            0::text AS movement_count
          FROM catalogue_product p
          LEFT JOIN inventory_stock s ON s.product_id = p.id
          ORDER BY lower(p.name), p.id`,
        );
    return {
      source: edgeSource ? ('edge' as const) : ('operational' as const),
      storeId,
      reportingLag: await this.reportingLag(),
      products: rows.rows.map((row) => ({
        productId: row.product_id,
        sku: row.sku,
        name: row.product_name,
        unit: row.unit,
        quantityMinor: safeInteger(row.quantity_minor),
        movementCount: safeInteger(row.movement_count),
      })),
    };
  }

  async operationDocuments(
    fromValue: string,
    toValue: string,
    pageValue?: string,
  ) {
    const { from, to } = this.validateRange(fromValue, toValue, 366);
    const page = pageValue === undefined ? 1 : Number(pageValue);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000)
      throw new BadRequestException('Invalid document page');
    const storeId = this.config.sync?.storeId ?? null;
    if (this.config.runtime.mode !== 'hosted' || !storeId) {
      return {
        from,
        to,
        page,
        storeId: null,
        source: 'edge' as const,
        total: 0,
        documents: [],
      };
    }
    const state = await this.database.connectionPool.query<{
      store_id: string;
      runtime_mode: string;
    }>(
      'SELECT store_id, runtime_mode FROM store_bootstrap_state WHERE singleton',
    );
    if (
      state.rows[0] &&
      (state.rows[0].store_id !== storeId ||
        state.rows[0].runtime_mode !== 'hosted')
    )
      throw new ServiceUnavailableException(
        'Store synchronization is unavailable',
      );
    const params = [storeId, from, to];
    const total = await this.database.connectionPool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM sync_operation_document_projection
       WHERE store_id = $1 AND (occurred_at AT TIME ZONE 'Africa/Nairobi')::date
         BETWEEN $2::date AND $3::date`,
      params,
    );
    const rows = await this.database.connectionPool.query<{
      event_id: string;
      document_id: string;
      event_type: string;
      occurred_at: string;
      actor_id: string;
      actor_name: string;
      reason: string;
      supplier_id: string | null;
      supplier_name: string | null;
      receipt_id: string | null;
      total_minor: string | null;
      product_id: string | null;
      product_name: string | null;
      sku: string | null;
      unit: string | null;
      previous_quantity_minor: string | null;
      counted_quantity_minor: string | null;
      delta_minor: string | null;
      lines: unknown;
    }>(
      `SELECT event_id,document_id,event_type,occurred_at,actor_id,actor_name,
        reason,supplier_id,supplier_name,receipt_id,total_minor,product_id,
        product_name,sku,unit,previous_quantity_minor,counted_quantity_minor,
        delta_minor,lines
       FROM sync_operation_document_projection
       WHERE store_id = $1 AND (occurred_at AT TIME ZONE 'Africa/Nairobi')::date
         BETWEEN $2::date AND $3::date
       ORDER BY occurred_at DESC,event_id DESC LIMIT 50 OFFSET $4`,
      [...params, (page - 1) * 50],
    );
    return {
      from,
      to,
      page,
      storeId,
      source: 'edge' as const,
      total: safeInteger(total.rows[0]?.total ?? 0),
      documents: rows.rows.map((row) => ({
        eventId: row.event_id,
        documentId: row.document_id,
        eventType: row.event_type,
        occurredAt: row.occurred_at,
        actorId: row.actor_id,
        actorName: row.actor_name,
        reason: row.reason,
        supplierId: row.supplier_id,
        supplierName: row.supplier_name,
        receiptId: row.receipt_id,
        totalMinor:
          row.total_minor === null ? null : safeInteger(row.total_minor),
        productId: row.product_id,
        productName: row.product_name,
        sku: row.sku,
        unit: row.unit,
        previousQuantityMinor:
          row.previous_quantity_minor === null
            ? null
            : safeInteger(row.previous_quantity_minor),
        countedQuantityMinor:
          row.counted_quantity_minor === null
            ? null
            : safeInteger(row.counted_quantity_minor),
        deltaMinor:
          row.delta_minor === null ? null : safeInteger(row.delta_minor),
        lines: row.lines,
      })),
    };
  }
}
