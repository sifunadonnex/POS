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
  syncConfigured: false;
  pendingEvents: number;
  oldestPendingAt: string | null;
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
      return {
        mode: 'hosted',
        storeId: null,
        checkoutAuthority: 'hosted',
        syncConfigured: false,
        pendingEvents: 0,
        oldestPendingAt: null,
      };
    }
    const result = await this.database.connectionPool.query<{
      pending_events: string;
      oldest_pending_at: string | null;
    }>(
      `SELECT count(*)::text AS pending_events,
        min(created_at)::text AS oldest_pending_at
      FROM sync_outbox
      WHERE store_id = $1 AND delivered_at IS NULL`,
      [runtime.storeId],
    );
    const row = result.rows[0];
    return {
      mode: 'edge',
      storeId: runtime.storeId,
      checkoutAuthority: 'local',
      syncConfigured: false,
      pendingEvents: Number(row?.pending_events ?? 0),
      oldestPendingAt: row?.oldest_pending_at ?? null,
    };
  }
}
