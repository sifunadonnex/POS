import { ConflictException } from '@nestjs/common';
import type { PoolClient } from 'pg';
import type { SyncEnvelope } from './sync-envelope.js';
import type { ActivityEnvelope } from './sync-activity-envelope.js';

export async function projectActivityEvent(
  client: Pick<PoolClient, 'query'>,
  envelope: ActivityEnvelope,
): Promise<void> {
  if (envelope.eventType === 'cash_sale.completed') {
    await projectCompletedCashSale(client, envelope);
  } else if (envelope.eventType === 'sale_refund.paid') {
    const p = envelope.payload;
    await client.query(
      `INSERT INTO sync_refund_projection
       (event_id,store_id,refund_id,sale_id,return_id,cashier_id,
        cashier_name,amount_minor,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        envelope.eventId,
        envelope.storeId,
        p.refundId,
        p.saleId,
        p.returnId,
        p.cashierId,
        p.cashierName,
        p.amountMinor,
        envelope.occurredAt,
      ],
    );
  } else if (envelope.eventType === 'stock_movement.recorded') {
    const p = envelope.payload;
    await client.query(
      `INSERT INTO sync_stock_movement_projection
       (event_id,store_id,movement_id,product_id,product_name,sku,unit,
        kind,delta_minor,quantity_after_minor,actor_id,reason,occurred_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        envelope.eventId,
        envelope.storeId,
        p.movementId,
        p.productId,
        p.productName,
        p.sku,
        p.unit,
        p.kind,
        p.deltaMinor,
        p.quantityAfterMinor,
        p.actorId,
        p.reason,
        envelope.occurredAt,
      ],
    );
  } else {
    const p = envelope.payload;
    await client.query(
      `INSERT INTO sync_operation_document_projection
       (event_id,store_id,document_id,event_type,occurred_at,
        actor_id,actor_name,reason,supplier_id,supplier_name,receipt_id,
        total_minor,product_id,product_name,sku,unit,
        previous_quantity_minor,counted_quantity_minor,delta_minor,lines)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
       ON CONFLICT (event_id) DO NOTHING`,
      [
        envelope.eventId,
        envelope.storeId,
        p.documentId,
        envelope.eventType,
        envelope.occurredAt,
        p.actorId,
        p.actorName,
        p.reason,
        p.supplierId ?? null,
        p.supplierName ?? null,
        p.receiptId ?? null,
        p.totalMinor ?? null,
        p.productId ?? null,
        p.productName ?? null,
        p.sku ?? null,
        p.unit ?? null,
        p.previousQuantityMinor ?? null,
        p.countedQuantityMinor ?? null,
        p.deltaMinor ?? null,
        JSON.stringify(p.lines ?? []),
      ],
    );
  }
}

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
