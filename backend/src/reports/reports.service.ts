import {
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

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
      const saleResult = await this.database.connectionPool.query<{ sale_count: number; sales_total_minor: number }>(
        `SELECT COUNT(*)::int AS sale_count, COALESCE(SUM(total_minor), 0)::bigint AS sales_total_minor
        FROM sale
        WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')`,
        [iso],
      );

      const paymentResult = await this.database.connectionPool.query<{ cash_minor: number; card_minor: number; mpesa_minor: number; payment_count: number }>(
        `SELECT
          COALESCE(SUM(CASE WHEN kind = 'cash' THEN amount_minor ELSE 0 END), 0)::bigint AS cash_minor,
          COALESCE(SUM(CASE WHEN kind = 'card' THEN amount_minor ELSE 0 END), 0)::bigint AS card_minor,
          COALESCE(SUM(CASE WHEN kind = 'mpesa' THEN amount_minor ELSE 0 END), 0)::bigint AS mpesa_minor,
          COUNT(*)::int AS payment_count
        FROM sale_payment
        WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')`,
        [iso],
      );

      const refundResult = await this.database.connectionPool.query<{ refund_minor: number; refund_count: number }>(
        `SELECT COALESCE(SUM(amount_minor), 0)::bigint AS refund_minor, COUNT(*)::int AS refund_count
        FROM sale_refund
        WHERE created_at >= $1::date AND created_at < ($1::date + interval '1 day')`,
        [iso],
      );

      const shiftResult = await this.database.connectionPool.query<{ closed_shift_count: number; variance_minor: number }>(
        `SELECT COUNT(*)::int AS closed_shift_count, COALESCE(SUM(variance_minor), 0)::bigint AS variance_minor
        FROM cash_shift
        WHERE closed_at >= $1::date AND closed_at < ($1::date + interval '1 day')`,
        [iso],
      );

      const stockResult = await this.database.connectionPool.query<{ low_stock_count: number }>(
        `SELECT COUNT(*)::int AS low_stock_count
        FROM inventory_stock
        WHERE quantity_minor <= 1000`,
      );

      const sale = saleResult.rows[0] ?? { sale_count: 0, sales_total_minor: 0 };
      const payment = paymentResult.rows[0] ?? { cash_minor: 0, card_minor: 0, mpesa_minor: 0, payment_count: 0 };
      const refund = refundResult.rows[0] ?? { refund_minor: 0, refund_count: 0 };
      const shift = shiftResult.rows[0] ?? { closed_shift_count: 0, variance_minor: 0 };
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
      throw new ServiceUnavailableException('Daily sales summary is temporarily unavailable');
    }
  }
}
