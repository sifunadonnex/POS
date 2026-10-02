import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { SyncEnvelope } from './sync-envelope.js';

export async function projectCompletedCashSale(
  client: Pick<PoolClient, 'query'>,
  envelope: SyncEnvelope,
): Promise<void> {
  const { payload } = envelope;
  await client.query(
    `INSERT INTO sync_cash_sale_projection
      (event_id, store_id, sale_id, cashier_id, cashier_name, shift_id,
        occurred_at, total_minor, payment_id, tendered_minor, change_minor)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    ON CONFLICT (event_id) DO NOTHING`,
    [
      envelope.eventId,
      envelope.storeId,
      payload.saleId,
      payload.cashierId,
      payload.cashierName,
      payload.shiftId,
      envelope.occurredAt,
      payload.totalMinor,
      payload.payment.paymentId,
      payload.payment.tenderedMinor,
      payload.payment.changeMinor,
    ],
  );

  for (const [index, line] of payload.lines.entries()) {
    await client.query(
      `INSERT INTO sync_cash_sale_line_projection
        (event_id, line_number, product_id, product_name, sku, unit,
          quantity_minor, unit_price_minor, line_total_minor)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (event_id, line_number) DO NOTHING`,
      [
        envelope.eventId,
        index + 1,
        line.productId,
        line.name,
        line.sku,
        line.unit,
        line.quantityMinor,
        line.priceMinor,
        line.lineTotalMinor,
      ],
    );
  }

  const projected = await client.query<{
    projected_lines: string;
    projected_total_minor: string;
  }>(
    `SELECT count(*)::text AS projected_lines,
      COALESCE(sum(line_total_minor), 0)::text AS projected_total_minor
    FROM sync_cash_sale_line_projection WHERE event_id = $1`,
    [envelope.eventId],
  );
  const row = projected.rows[0];
  if (
    Number(row?.projected_lines ?? 0) !== payload.lines.length ||
    Number(row?.projected_total_minor ?? 0) !== payload.totalMinor
  ) {
    throw new ConflictException(
      'This synchronization event conflicts with its reporting projection',
    );
  }
}
