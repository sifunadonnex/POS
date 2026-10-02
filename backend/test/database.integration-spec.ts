import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client, Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { parseSyncEnvelope } from '../src/sync/sync-envelope.js';
import { projectCompletedCashSale } from '../src/sync/sync-projection.js';

it('applies migrations once, rolls back and reapplies in an isolated test schema', async () => {
  // Intentionally never fall back to DATABASE_URL or load the application's .env.
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('_test')) {
    throw new Error(
      'Set TEST_DATABASE_URL to a dedicated database whose name ends in _test',
    );
  }
  const config = parseEnvironment({
    DATABASE_URL: url,
    DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
    NODE_ENV: 'test',
  });
  const client = new Client(databaseOptions(config));
  const schema = `integration_${randomUUID().replaceAll('-', '')}`;
  await client.connect();
  try {
    await client.query(`CREATE SCHEMA "${schema}"`);
    const options = {
      dbClient: client,
      dir: fileURLToPath(new URL('../migrations/', import.meta.url)),
      migrationsTable: 'pgmigrations',
      schema,
      migrationsSchema: schema,
      singleTransaction: true,
      checkOrder: true,
      log: () => undefined,
    };
    expect(await runner({ ...options, direction: 'up' })).toHaveLength(20);
    expect(await runner({ ...options, direction: 'up' })).toHaveLength(0);
    const result = await client.query<{ value: string }>(
      `SELECT value FROM "${schema}".app_metadata WHERE key = $1`,
      ['application'],
    );
    expect(result.rows).toEqual([{ value: 'pay-and-go' }]);
    await client.query(`SET search_path TO "${schema}"`);
    const eventId = randomUUID();
    const storeId = randomUUID();
    const saleId = randomUUID();
    const occurredAt = new Date().toISOString();
    const envelope = parseSyncEnvelope({
      eventId,
      storeId,
      eventType: 'cash_sale.completed',
      aggregateId: saleId,
      schemaVersion: 1,
      occurredAt,
      payload: {
        eventId,
        storeId,
        eventType: 'cash_sale.completed',
        schemaVersion: 1,
        requestId: randomUUID(),
        saleId,
        cashierId: 'cashier-integration',
        shiftId: randomUUID(),
        occurredAt,
        totalMinor: 1250,
        lines: [
          {
            productId: randomUUID(),
            unit: 'each',
            quantity: 1,
            priceMinor: 1250,
            lineTotalMinor: 1250,
          },
        ],
        payment: {
          paymentId: randomUUID(),
          amountMinor: 1250,
          tenderedMinor: 1500,
          changeMinor: 250,
        },
      },
    });
    await client.query(
      `INSERT INTO sync_inbox
        (id, store_id, event_type, aggregate_id, schema_version, payload,
          payload_hash, occurred_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        eventId,
        storeId,
        envelope.eventType,
        saleId,
        envelope.schemaVersion,
        JSON.stringify(envelope.payload),
        'a'.repeat(64),
        occurredAt,
      ],
    );
    await projectCompletedCashSale(client, envelope);
    await projectCompletedCashSale(client, envelope);
    const projection = await client.query<{
      sale_count: number;
      line_count: number;
      total_minor: string;
    }>(
      `SELECT
        (SELECT count(*)::int FROM sync_cash_sale_projection) AS sale_count,
        count(*)::int AS line_count,
        COALESCE(sum(line_total_minor), 0)::text AS total_minor
      FROM sync_cash_sale_line_projection`,
    );
    expect(projection.rows[0]).toEqual({
      sale_count: 1,
      line_count: 1,
      total_minor: '1250',
    });
    const reportDay = (
      await client.query<{ day: string }>(
        "SELECT to_char(now() AT TIME ZONE 'Africa/Nairobi', 'YYYY-MM-DD') AS day",
      )
    ).rows[0].day;
    const reportPool = new Pool({
      ...databaseOptions(config),
      options: `-c search_path=${schema}`,
    });
    let edgeInsights: Awaited<ReturnType<ReportsService['salesInsights']>>;
    try {
      const reports = new ReportsService(
        {
          ...config,
          sync: {
            storeId,
            secret: 's'.repeat(32),
            targetUrl: null,
            pollSeconds: 10,
          },
        },
        { connectionPool: reportPool } as never,
      );
      edgeInsights = await reports.salesInsights(
        reportDay,
        reportDay,
        'edge',
        storeId,
      );
    } finally {
      await reportPool.end();
    }
    expect(edgeInsights.summary).toMatchObject({
      saleCount: 1,
      grossSalesMinor: 1250,
      refundMinor: 0,
    });
    expect(edgeInsights.topProducts).toEqual([
      expect.objectContaining({
        productName: 'Legacy product',
        source: 'edge',
      }),
    ]);
    expect(edgeInsights.reportingLag).toMatchObject({
      status: 'current',
      receivedEvents: 1,
      projectedEvents: 1,
    });
    const versionTwoEventId = randomUUID();
    await client.query(
      `INSERT INTO sync_inbox
        (id, store_id, event_type, aggregate_id, schema_version, payload,
          payload_hash, occurred_at)
      VALUES ($1, $2, 'cash_sale.completed', $3, 2, '{}'::jsonb, $4, now())`,
      [versionTwoEventId, storeId, randomUUID(), 'b'.repeat(64)],
    );
    await client.query('DELETE FROM sync_inbox WHERE id = $1', [
      versionTwoEventId,
    ]);
    await expect(
      client.query(
        'UPDATE sync_cash_sale_projection SET total_minor = 1 WHERE event_id = $1',
        [eventId],
      ),
    ).rejects.toThrow('synchronized reporting projections are append-only');
    expect(
      await runner({ ...options, direction: 'down', count: 1 }),
    ).toHaveLength(1);
    expect(await runner({ ...options, direction: 'up' })).toHaveLength(1);
  } finally {
    try {
      await client.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await client.end();
    }
  }
});
