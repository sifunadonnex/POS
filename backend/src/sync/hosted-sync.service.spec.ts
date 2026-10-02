import { createHash } from 'node:crypto';
import type { AppConfig } from '../config/environment.js';
import { canonicalJson, createSyncSignature } from './sync-auth.js';
import { HostedSyncService } from './hosted-sync.service.js';
import type { SyncEnvelope } from './sync-envelope.js';

const now = Date.UTC(2026, 9, 2, 12, 0, 0);
const timestamp = String(Math.floor(now / 1000));
const storeId = '11111111-1111-4111-8111-111111111111';
const eventId = '22222222-2222-4222-8222-222222222222';
const saleId = '33333333-3333-4333-8333-333333333333';
const secret = 's'.repeat(32);

const envelope: SyncEnvelope = {
  eventId,
  storeId,
  eventType: 'cash_sale.completed',
  aggregateId: saleId,
  schemaVersion: 1,
  occurredAt: '2026-10-02T11:59:00.000Z',
  payload: {
    eventId,
    storeId,
    eventType: 'cash_sale.completed',
    schemaVersion: 1,
    requestId: '44444444-4444-4444-8444-444444444444',
    saleId,
    cashierId: 'cashier-1',
    shiftId: '55555555-5555-4555-8555-555555555555',
    occurredAt: '2026-10-02T11:59:00.000Z',
    totalMinor: 1250,
    lines: [
      {
        productId: '66666666-6666-4666-8666-666666666666',
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

function config(): AppConfig {
  return {
    nodeEnv: 'test',
    port: 3000,
    databaseUrl: 'postgresql://test:fake@localhost/test',
    databaseTls: false,
    databasePoolMax: 5,
    runtime: { mode: 'hosted', storeId: null },
    daraja: null,
    sync: { storeId, secret, targetUrl: null, pollSeconds: 10 },
  };
}

function headers(value: unknown = envelope) {
  return {
    storeId,
    eventId,
    timestamp,
    signature: createSyncSignature(secret, storeId, eventId, timestamp, value),
  };
}

describe('HostedSyncService', () => {
  it('persists a signed event and acknowledges only after commit', async () => {
    const calls: string[] = [];
    const query = vi.fn(async (sql: string) => {
      calls.push(sql);
      if (sql.includes('SELECT id, payload_hash')) return { rows: [] };
      if (sql.includes('accepted_events')) {
        return {
          rows: [
            {
              accepted_events: '1',
              latest_received_at: '2026-10-02 12:00:00+00',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const release = vi.fn();
    const service = new HostedSyncService(config(), {
      connectionPool: {
        connect: vi.fn().mockResolvedValue({ query, release }),
      },
    } as never);

    await expect(service.ingest(headers(), envelope, now)).resolves.toEqual({
      eventId,
      status: 'accepted',
      checkpoint: {
        acceptedEvents: 1,
        latestReceivedAt: '2026-10-02 12:00:00+00',
      },
    });
    expect(calls.some((sql) => sql.includes('INSERT INTO sync_inbox'))).toBe(
      true,
    );
    expect(calls.at(-1)).toBe('COMMIT');
    expect(release).toHaveBeenCalledOnce();
  });

  it('rejects stale and payload-tampered requests before database access', async () => {
    const connect = vi.fn();
    const service = new HostedSyncService(config(), {
      connectionPool: { connect },
    } as never);

    await expect(
      service.ingest(headers(), envelope, now + 301_000),
    ).rejects.toThrow('Invalid synchronization credentials');
    await expect(
      service.ingest(headers(), { ...envelope, aggregateId: eventId }, now),
    ).rejects.toThrow('Invalid synchronization credentials');
    expect(connect).not.toHaveBeenCalled();
  });

  it('acknowledges an identical replay without inserting it again', async () => {
    const fingerprint = createHash('sha256')
      .update(canonicalJson(envelope))
      .digest('hex');
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT id, payload_hash')) {
        return { rows: [{ id: eventId, payload_hash: fingerprint }] };
      }
      if (sql.includes('accepted_events')) {
        return { rows: [{ accepted_events: '1', latest_received_at: null }] };
      }
      return { rows: [] };
    });
    const service = new HostedSyncService(config(), {
      connectionPool: {
        connect: vi.fn().mockResolvedValue({ query, release: vi.fn() }),
      },
    } as never);

    await expect(
      service.ingest(headers(), envelope, now),
    ).resolves.toMatchObject({ eventId, status: 'duplicate' });
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO sync_inbox'),
      ),
    ).toBe(false);
  });

  it('rejects internally inconsistent cash totals even with a valid signature', async () => {
    const invalid = structuredClone(envelope);
    invalid.payload.totalMinor = 1300;
    const connect = vi.fn();
    const service = new HostedSyncService(config(), {
      connectionPool: { connect },
    } as never);

    await expect(
      service.ingest(headers(invalid), invalid, now),
    ).rejects.toThrow('Invalid completed cash sale');
    expect(connect).not.toHaveBeenCalled();
  });
});
