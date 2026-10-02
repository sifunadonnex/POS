import type { AppConfig } from '../config/environment.js';
import { EdgeSyncWorker } from './edge-sync.worker.js';

const storeId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const saleId = '33333333-3333-4333-8333-333333333333';

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://test:fake@localhost/test',
    databaseTls: false,
    databasePoolMax: 5,
    runtime: { mode: 'edge', storeId },
    daraja: null,
    sync: {
      storeId,
      secret: 's'.repeat(32),
      targetUrl: 'https://pos.example.test/api/sync/events',
      pollSeconds: 10,
    },
  };
}

const job = {
  id: eventId,
  store_id: storeId,
  event_type: 'cash_sale.completed',
  aggregate_id: saleId,
  schema_version: 2,
  attempt_count: 1,
  payload: {
    eventId,
    storeId,
    eventType: 'cash_sale.completed',
    schemaVersion: 2,
    requestId: '44444444-4444-4444-8444-444444444444',
    saleId,
    cashierId: 'cashier-1',
    cashierName: 'Amina Cashier',
    shiftId: '55555555-5555-4555-8555-555555555555',
    occurredAt: '2026-10-02T11:59:00.000Z',
    totalMinor: 1250,
    lines: [
      {
        productId: '66666666-6666-4666-8666-666666666666',
        name: 'Test Product',
        sku: 'TEST-1',
        unit: 'each',
        quantity: 1,
        priceMinor: 1250,
        lineTotalMinor: 1250,
      },
    ],
    payment: {
      paymentId: '77777777-7777-4777-8777-777777777777',
      amountMinor: 1250,
      tenderedMinor: 1500,
      changeMinor: 250,
    },
  },
};

describe('EdgeSyncWorker', () => {
  it('marks an event delivered only after a matching acknowledgement', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [job] })
      .mockResolvedValueOnce({ rows: [] });
    const fetcher = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ eventId, status: 'accepted' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const worker = new EdgeSyncWorker(
      config(),
      { connectionPool: { query } } as never,
      fetcher,
    );

    await expect(worker.deliverBatch()).resolves.toBe(1);
    expect(fetcher).toHaveBeenCalledWith(
      'https://pos.example.test/api/sync/events',
      expect.objectContaining({
        method: 'POST',
        redirect: 'error',
        headers: expect.objectContaining({
          'X-PayGo-Store-Id': storeId,
          'X-PayGo-Event-Id': eventId,
        }),
      }),
    );
    expect(String(query.mock.calls[1][0])).toContain('delivered_at = now()');
  });

  it('retains an event and schedules backoff after an invalid response', async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({ rows: [job] })
      .mockResolvedValueOnce({ rows: [] });
    const worker = new EdgeSyncWorker(
      config(),
      { connectionPool: { query } } as never,
      vi.fn().mockResolvedValue(new Response('{}', { status: 503 })),
    );

    await expect(worker.deliverBatch()).resolves.toBe(1);
    expect(String(query.mock.calls[1][0])).toContain('next_attempt_at');
    expect(query.mock.calls[1][1]).toEqual([eventId, 5, 1]);
  });
});
