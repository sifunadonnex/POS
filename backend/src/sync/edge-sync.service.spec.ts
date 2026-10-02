import type { PoolClient } from 'pg';
import type { AppConfig } from '../config/environment.js';
import {
  EdgeSyncService,
  type CompletedCashSaleEvent,
} from './edge-sync.service.js';

const event: CompletedCashSaleEvent = {
  requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  saleId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  cashierId: 'cashier-1',
  shiftId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  occurredAt: '2026-10-02T10:00:00.000Z',
  totalMinor: 1250,
  lines: [
    {
      productId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      unit: 'each',
      quantity: 1,
      priceMinor: 1250,
      lineTotalMinor: 1250,
    },
  ],
  payment: {
    paymentId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
    amountMinor: 1250,
    tenderedMinor: 1500,
    changeMinor: 250,
  },
};

function config(mode: 'hosted' | 'edge'): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://test:fake@localhost/test',
    databaseTls: false,
    databasePoolMax: 5,
    runtime: {
      mode,
      storeId: mode === 'edge' ? '11111111-1111-4111-8111-111111111111' : null,
    },
    daraja: null,
  };
}

describe('EdgeSyncService', () => {
  it('atomically appends a completed edge cash sale payload', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new EdgeSyncService(config('edge'), {
      connectionPool: {} as never,
    } as never);

    await service.enqueueCompletedCashSale(
      { query } as unknown as PoolClient,
      event,
    );

    expect(query).toHaveBeenCalledOnce();
    const [, parameters] = query.mock.calls[0] as [string, unknown[]];
    expect(parameters[1]).toBe('11111111-1111-4111-8111-111111111111');
    expect(JSON.parse(String(parameters[3]))).toMatchObject({
      eventType: 'cash_sale.completed',
      schemaVersion: 1,
      saleId: event.saleId,
      payment: event.payment,
    });
  });

  it('does not create outbox records in hosted mode', async () => {
    const query = vi.fn();
    const service = new EdgeSyncService(config('hosted'), {
      connectionPool: {} as never,
    } as never);

    await service.enqueueCompletedCashSale(
      { query } as unknown as PoolClient,
      event,
    );

    expect(query).not.toHaveBeenCalled();
    await expect(service.status()).resolves.toMatchObject({
      mode: 'hosted',
      checkoutAuthority: 'hosted',
      pendingEvents: 0,
    });
  });

  it('reports pending edge events from the durable outbox', async () => {
    const service = new EdgeSyncService(config('edge'), {
      connectionPool: {
        query: vi.fn().mockResolvedValue({
          rows: [
            {
              pending_events: '3',
              oldest_pending_at: '2026-10-02 10:00:00+00',
            },
          ],
        }),
      },
    } as never);

    await expect(service.status()).resolves.toMatchObject({
      mode: 'edge',
      checkoutAuthority: 'local',
      pendingEvents: 3,
    });
  });
});
