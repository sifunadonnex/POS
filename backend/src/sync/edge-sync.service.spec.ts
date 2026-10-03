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
  cashierName: 'Amina Cashier',
  shiftId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  occurredAt: '2026-10-02T10:00:00.000Z',
  totalMinor: 1250,
  lines: [
    {
      productId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      name: 'Test Product',
      sku: 'TEST-1',
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
    sync: null,
    bootstrap: null,
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
      schemaVersion: 2,
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

  it('reconciles exact queued and delivered edge event totals', async () => {
    const service = new EdgeSyncService(config('edge'), {
      connectionPool: {
        query: vi.fn().mockResolvedValue({
          rows: [
            {
              enqueued_events: '5',
              enqueued_total_minor: '8250',
              pending_events: '2',
              pending_total_minor: '3000',
              delivered_events: '3',
              delivered_total_minor: '5250',
            },
          ],
        }),
      },
    } as never);

    await expect(service.reconciliation()).resolves.toEqual({
      mode: 'edge',
      storeId: '11111111-1111-4111-8111-111111111111',
      enqueuedEvents: 5,
      enqueuedTotalMinor: '8250',
      pendingEvents: 2,
      pendingTotalMinor: '3000',
      deliveredEvents: 3,
      deliveredTotalMinor: '5250',
    });
  });

  it('reconciles hosted inbox totals with projected reporting totals', async () => {
    const hostedConfig: AppConfig = {
      ...config('hosted'),
      sync: {
        storeId: '11111111-1111-4111-8111-111111111111',
        secret: 's'.repeat(32),
        targetUrl: null,
        pollSeconds: 10,
      },
    };
    const service = new EdgeSyncService(hostedConfig, {
      connectionPool: {
        query: vi.fn().mockResolvedValue({
          rows: [
            {
              received_events: '4',
              received_total_minor: '7300',
              projected_events: '3',
              projected_total_minor: '6100',
              unprojected_events: '1',
              amount_variance_minor: '1200',
            },
          ],
        }),
      },
    } as never);

    await expect(service.reconciliation()).resolves.toEqual({
      mode: 'hosted',
      storeId: '11111111-1111-4111-8111-111111111111',
      receivedEvents: 4,
      receivedTotalMinor: '7300',
      projectedEvents: 3,
      projectedTotalMinor: '6100',
      unprojectedEvents: 1,
      amountVarianceMinor: '1200',
    });
  });
});
