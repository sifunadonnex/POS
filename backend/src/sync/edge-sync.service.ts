import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';

export type CompletedCashSaleEvent = {
  requestId: string;
  saleId: string;
  cashierId: string;
  shiftId: string;
  occurredAt: string;
  totalMinor: number;
  lines: Array<{
    productId: string;
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
      VALUES ($1, $2, 'cash_sale.completed', $3, 1, $4)`,
      [
        eventId,
        runtime.storeId,
        event.saleId,
        JSON.stringify({
          eventId,
          eventType: 'cash_sale.completed',
          schemaVersion: 1,
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
        }>(
          `SELECT count(*)::text AS received_events,
            max(received_at)::text AS latest_received_at
          FROM sync_inbox WHERE store_id = $1`,
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
    };
  }
}
