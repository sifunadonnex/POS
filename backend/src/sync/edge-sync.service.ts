import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';

export type CompletedCashSaleEvent = {
  requestId: string;
  saleId: string;
  cashierId: string;
  cashierName: string;
  shiftId: string;
  occurredAt: string;
  totalMinor: number;
  lines: Array<{
    productId: string;
    name: string;
    sku: string;
    unit: 'each' | 'pack' | 'kg' | 'l';
    quantity: number;
    priceMinor: number;
    lineTotalMinor: number;
  }>;
  payment: {
    paymentId: string;
    amountMinor: number;
    tenderedMinor: number;
    changeMinor: number;
  };
};

export type EdgeSyncStatus = {
  mode: 'hosted' | 'edge';
  storeId: string | null;
  checkoutAuthority: 'hosted' | 'local';
  syncConfigured: boolean;
  pendingEvents: number;
  oldestPendingAt: string | null;
  deliveredEvents: number;
  latestDeliveredAt: string | null;
  receivedEvents: number;
  latestReceivedAt: string | null;
  projectedEvents: number;
  unprojectedEvents: number;
};

export type SyncReconciliation =
  | {
      mode: 'hosted';
      storeId: string;
      receivedEvents: number;
      receivedTotalMinor: string;
      projectedEvents: number;
      projectedTotalMinor: string;
      unprojectedEvents: number;
      amountVarianceMinor: string;
      receivedRefundMinor: string;
      projectedRefundMinor: string;
      refundVarianceMinor: string;
      receivedStockDeltaMinor: string;
      projectedStockDeltaMinor: string;
      stockDeltaVarianceMinor: string;
    }
  | {
      mode: 'edge';
      storeId: string;
      enqueuedEvents: number;
      enqueuedTotalMinor: string;
      pendingEvents: number;
      pendingTotalMinor: string;
      deliveredEvents: number;
      deliveredTotalMinor: string;
      enqueuedRefundMinor: string;
      pendingRefundMinor: string;
      deliveredRefundMinor: string;
      enqueuedStockDeltaMinor: string;
      pendingStockDeltaMinor: string;
      deliveredStockDeltaMinor: string;
    };

@Injectable()
export class EdgeSyncService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async enqueueCompletedCashSale(
    client: PoolClient,
    event: CompletedCashSaleEvent,
  ): Promise<void> {
    const { runtime } = this.config;
    if (runtime.mode !== 'edge' || !runtime.storeId) return;
    const eventId = randomUUID();
    await client.query(
      `INSERT INTO sync_outbox
        (id, store_id, event_type, aggregate_id, schema_version, payload)
      VALUES ($1, $2, 'cash_sale.completed', $3, 2, $4)`,
      [
        eventId,
        runtime.storeId,
        event.saleId,
        JSON.stringify({
          eventId,
          eventType: 'cash_sale.completed',
          schemaVersion: 2,
          storeId: runtime.storeId,
          ...event,
        }),
      ],
    );
  }

  async status(): Promise<EdgeSyncStatus> {
    const { runtime } = this.config;
    if (runtime.mode === 'hosted') {
      if (this.config.sync) {
        const result = await this.database.connectionPool.query<{
          received_events: string;
          latest_received_at: string | null;
          projected_events: string;
          unprojected_events: string;
        }>(
          `SELECT count(i.id)::text AS received_events,
            max(i.received_at)::text AS latest_received_at,
            (count(p.event_id) + count(r.event_id) + count(m.event_id)
              + count(d.event_id))::text
              AS projected_events,
            count(i.id) FILTER (WHERE
              (i.event_type = 'cash_sale.completed' AND p.event_id IS NULL) OR
              (i.event_type = 'sale_refund.paid' AND r.event_id IS NULL) OR
              (i.event_type = 'stock_movement.recorded' AND m.event_id IS NULL) OR
              (i.event_type IN ('purchase_receipt.received',
                'purchase_return.returned', 'stocktake.counted') AND d.event_id IS NULL)
            )::text AS unprojected_events
          FROM sync_inbox i
          LEFT JOIN sync_cash_sale_projection p ON p.event_id = i.id
          LEFT JOIN sync_refund_projection r ON r.event_id = i.id
          LEFT JOIN sync_stock_movement_projection m ON m.event_id = i.id
          LEFT JOIN sync_operation_document_projection d ON d.event_id = i.id
          WHERE i.store_id = $1`,
          [this.config.sync.storeId],
        );
        return {
          mode: 'hosted',
          storeId: this.config.sync.storeId,
          checkoutAuthority: 'hosted',
          syncConfigured: true,
          pendingEvents: 0,
          oldestPendingAt: null,
          deliveredEvents: 0,
          latestDeliveredAt: null,
          receivedEvents: Number(result.rows[0]?.received_events ?? 0),
          latestReceivedAt: result.rows[0]?.latest_received_at ?? null,
          projectedEvents: Number(result.rows[0]?.projected_events ?? 0),
          unprojectedEvents: Number(result.rows[0]?.unprojected_events ?? 0),
        };
      }
      return {
        mode: 'hosted',
        storeId: null,
        checkoutAuthority: 'hosted',
        syncConfigured: Boolean(this.config.sync),
        pendingEvents: 0,
        oldestPendingAt: null,
        deliveredEvents: 0,
        latestDeliveredAt: null,
        receivedEvents: 0,
        latestReceivedAt: null,
        projectedEvents: 0,
        unprojectedEvents: 0,
      };
    }
    const result = await this.database.connectionPool.query<{
      pending_events: string;
      oldest_pending_at: string | null;
      delivered_events: string;
      latest_delivered_at: string | null;
    }>(
      `SELECT count(*) FILTER (WHERE delivered_at IS NULL)::text AS pending_events,
        min(created_at) FILTER (WHERE delivered_at IS NULL)::text AS oldest_pending_at,
        count(*) FILTER (WHERE delivered_at IS NOT NULL)::text AS delivered_events,
        max(delivered_at)::text AS latest_delivered_at
      FROM sync_outbox
      WHERE store_id = $1`,
      [runtime.storeId],
    );
    const row = result.rows[0];
    return {
      mode: 'edge',
      storeId: runtime.storeId,
      checkoutAuthority: 'local',
      syncConfigured: Boolean(this.config.sync?.targetUrl),
      pendingEvents: Number(row?.pending_events ?? 0),
      oldestPendingAt: row?.oldest_pending_at ?? null,
      deliveredEvents: Number(row?.delivered_events ?? 0),
      latestDeliveredAt: row?.latest_delivered_at ?? null,
      receivedEvents: 0,
      latestReceivedAt: null,
      projectedEvents: 0,
      unprojectedEvents: 0,
    };
  }

  async reconciliation(): Promise<SyncReconciliation> {
    const { runtime, sync } = this.config;
    if (runtime.mode === 'hosted') {
      if (!sync) {
        throw new ServiceUnavailableException(
          'Synchronization is not configured',
        );
      }
      const result = await this.database.connectionPool.query<{
        received_events: string;
        received_total_minor: string;
        projected_events: string;
        projected_total_minor: string;
        unprojected_events: string;
        amount_variance_minor: string;
        received_refund_minor: string;
        projected_refund_minor: string;
        refund_variance_minor: string;
        received_stock_delta_minor: string;
        projected_stock_delta_minor: string;
        stock_delta_variance_minor: string;
      }>(
        `SELECT count(i.id)::text AS received_events,
          COALESCE(sum((i.payload->>'totalMinor')::bigint)
            FILTER (WHERE i.event_type = 'cash_sale.completed'), 0)::text
            AS received_total_minor,
          (count(p.event_id) + count(r.event_id) + count(m.event_id)
            + count(d.event_id))::text
            AS projected_events,
          COALESCE(sum(p.total_minor), 0)::text AS projected_total_minor,
          count(i.id) FILTER (WHERE
            (i.event_type = 'cash_sale.completed' AND p.event_id IS NULL) OR
            (i.event_type = 'sale_refund.paid' AND r.event_id IS NULL) OR
            (i.event_type = 'stock_movement.recorded' AND m.event_id IS NULL) OR
            (i.event_type IN ('purchase_receipt.received',
              'purchase_return.returned', 'stocktake.counted') AND d.event_id IS NULL)
          )::text AS unprojected_events,
          (COALESCE(sum((i.payload->>'totalMinor')::bigint)
            FILTER (WHERE i.event_type = 'cash_sale.completed'), 0) -
            COALESCE(sum(p.total_minor), 0))::text AS amount_variance_minor,
          COALESCE(sum((i.payload->>'amountMinor')::bigint)
            FILTER (WHERE i.event_type = 'sale_refund.paid'), 0)::text
            AS received_refund_minor,
          COALESCE(sum(r.amount_minor), 0)::text AS projected_refund_minor,
          (COALESCE(sum((i.payload->>'amountMinor')::bigint)
            FILTER (WHERE i.event_type = 'sale_refund.paid'), 0) -
            COALESCE(sum(r.amount_minor), 0))::text AS refund_variance_minor,
          COALESCE(sum((i.payload->>'deltaMinor')::bigint)
            FILTER (WHERE i.event_type = 'stock_movement.recorded'), 0)::text
            AS received_stock_delta_minor,
          COALESCE(sum(m.delta_minor), 0)::text AS projected_stock_delta_minor,
          (COALESCE(sum((i.payload->>'deltaMinor')::bigint)
            FILTER (WHERE i.event_type = 'stock_movement.recorded'), 0) -
            COALESCE(sum(m.delta_minor), 0))::text AS stock_delta_variance_minor
        FROM sync_inbox i
        LEFT JOIN sync_cash_sale_projection p ON p.event_id = i.id
        LEFT JOIN sync_refund_projection r ON r.event_id = i.id
        LEFT JOIN sync_stock_movement_projection m ON m.event_id = i.id
        LEFT JOIN sync_operation_document_projection d ON d.event_id = i.id
        WHERE i.store_id = $1`,
        [sync.storeId],
      );
      const row = result.rows[0];
      return {
        mode: 'hosted',
        storeId: sync.storeId,
        receivedEvents: Number(row?.received_events ?? 0),
        receivedTotalMinor: row?.received_total_minor ?? '0',
        projectedEvents: Number(row?.projected_events ?? 0),
        projectedTotalMinor: row?.projected_total_minor ?? '0',
        unprojectedEvents: Number(row?.unprojected_events ?? 0),
        amountVarianceMinor: row?.amount_variance_minor ?? '0',
        receivedRefundMinor: row?.received_refund_minor ?? '0',
        projectedRefundMinor: row?.projected_refund_minor ?? '0',
        refundVarianceMinor: row?.refund_variance_minor ?? '0',
        receivedStockDeltaMinor: row?.received_stock_delta_minor ?? '0',
        projectedStockDeltaMinor: row?.projected_stock_delta_minor ?? '0',
        stockDeltaVarianceMinor: row?.stock_delta_variance_minor ?? '0',
      };
    }
    if (!runtime.storeId) {
      throw new ServiceUnavailableException('The edge store ID is unavailable');
    }
    const result = await this.database.connectionPool.query<{
      enqueued_events: string;
      enqueued_total_minor: string;
      pending_events: string;
      pending_total_minor: string;
      delivered_events: string;
      delivered_total_minor: string;
      enqueued_refund_minor: string;
      pending_refund_minor: string;
      delivered_refund_minor: string;
      enqueued_stock_delta_minor: string;
      pending_stock_delta_minor: string;
      delivered_stock_delta_minor: string;
    }>(
      `SELECT count(*)::text AS enqueued_events,
        COALESCE(sum((payload->>'totalMinor')::bigint)
          FILTER (WHERE event_type = 'cash_sale.completed'), 0)::text
          AS enqueued_total_minor,
        count(*) FILTER (WHERE delivered_at IS NULL)::text AS pending_events,
        COALESCE(sum((payload->>'totalMinor')::bigint)
          FILTER (WHERE delivered_at IS NULL AND
            event_type = 'cash_sale.completed'), 0)::text AS pending_total_minor,
        count(*) FILTER (WHERE delivered_at IS NOT NULL)::text AS delivered_events,
        COALESCE(sum((payload->>'totalMinor')::bigint)
          FILTER (WHERE delivered_at IS NOT NULL AND
            event_type = 'cash_sale.completed'), 0)::text AS delivered_total_minor,
        COALESCE(sum((payload->>'amountMinor')::bigint)
          FILTER (WHERE event_type = 'sale_refund.paid'), 0)::text
          AS enqueued_refund_minor,
        COALESCE(sum((payload->>'amountMinor')::bigint)
          FILTER (WHERE delivered_at IS NULL AND
            event_type = 'sale_refund.paid'), 0)::text AS pending_refund_minor,
        COALESCE(sum((payload->>'amountMinor')::bigint)
          FILTER (WHERE delivered_at IS NOT NULL AND
            event_type = 'sale_refund.paid'), 0)::text AS delivered_refund_minor,
        COALESCE(sum((payload->>'deltaMinor')::bigint)
          FILTER (WHERE event_type = 'stock_movement.recorded'), 0)::text
          AS enqueued_stock_delta_minor,
        COALESCE(sum((payload->>'deltaMinor')::bigint)
          FILTER (WHERE delivered_at IS NULL AND
            event_type = 'stock_movement.recorded'), 0)::text
          AS pending_stock_delta_minor,
        COALESCE(sum((payload->>'deltaMinor')::bigint)
          FILTER (WHERE delivered_at IS NOT NULL AND
            event_type = 'stock_movement.recorded'), 0)::text
          AS delivered_stock_delta_minor
      FROM sync_outbox WHERE store_id = $1`,
      [runtime.storeId],
    );
    const row = result.rows[0];
    return {
      mode: 'edge',
      storeId: runtime.storeId,
      enqueuedEvents: Number(row?.enqueued_events ?? 0),
      enqueuedTotalMinor: row?.enqueued_total_minor ?? '0',
      pendingEvents: Number(row?.pending_events ?? 0),
      pendingTotalMinor: row?.pending_total_minor ?? '0',
      deliveredEvents: Number(row?.delivered_events ?? 0),
      deliveredTotalMinor: row?.delivered_total_minor ?? '0',
      enqueuedRefundMinor: row?.enqueued_refund_minor ?? '0',
      pendingRefundMinor: row?.pending_refund_minor ?? '0',
      deliveredRefundMinor: row?.delivered_refund_minor ?? '0',
      enqueuedStockDeltaMinor: row?.enqueued_stock_delta_minor ?? '0',
      pendingStockDeltaMinor: row?.pending_stock_delta_minor ?? '0',
      deliveredStockDeltaMinor: row?.delivered_stock_delta_minor ?? '0',
    };
  }
}
