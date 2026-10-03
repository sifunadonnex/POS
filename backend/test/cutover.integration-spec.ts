import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  ConflictException,
  ForbiddenException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { applyBootstrapBundle } from '../src/store/edge-bootstrap.service.js';
import { applyCutoverTicket } from '../src/store/edge-cutover.js';
import { HostedBootstrapService } from '../src/store/hosted-bootstrap.service.js';
import { HostedCutoverService } from '../src/store/hosted-cutover.service.js';
import { StoreAuthorityService } from '../src/store/store-authority.service.js';
import { createSyncSignature } from '../src/sync/sync-auth.js';
import { HostedSyncService } from '../src/sync/hosted-sync.service.js';

describe('cutover and generation fencing on disposable PostgreSQL', () => {
  const storeId = randomUUID();
  const managerId = randomUUID();
  const managerSession = randomUUID();
  const oldSecret = 'o'.repeat(48);
  const newSecret = 'n'.repeat(48);
  const bootstrapSecret = 'b'.repeat(48);
  const schemas = [
    `cut_host_${randomUUID().replaceAll('-', '')}`,
    `cut_edge_${randomUUID().replaceAll('-', '')}`,
  ];
  let hosted: Pool;
  let edge: Pool;
  let originalGate: string | undefined;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Explicit _test database required');
    originalGate = process.env.PAYGO_CUTOVER_ENABLED;
    process.env.PAYGO_CUTOVER_ENABLED = 'true';
    const options = databaseOptions(
      parseEnvironment({
        DATABASE_URL: url,
        DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
        NODE_ENV: 'test',
      }),
    );
    hosted = new Pool({ ...options, options: `-c search_path=${schemas[0]}` });
    edge = new Pool({ ...options, options: `-c search_path=${schemas[1]}` });
    for (const [index, pool] of [hosted, edge].entries()) {
      await pool.query(`CREATE SCHEMA "${schemas[index]}"`);
      const client = await pool.connect();
      try {
        await runner({
          dbClient: client,
          dir: fileURLToPath(new URL('../migrations/', import.meta.url)),
          schema: schemas[index],
          migrationsSchema: schemas[index],
          migrationsTable: 'pgmigrations',
          direction: 'up',
          singleTransaction: true,
          log: () => undefined,
        });
      } finally {
        client.release();
      }
    }
  });

  afterAll(async () => {
    if (originalGate === undefined) delete process.env.PAYGO_CUTOVER_ENABLED;
    else process.env.PAYGO_CUTOVER_ENABLED = originalGate;
    for (const [index, pool] of [hosted, edge].entries()) {
      if (pool) {
        await pool.query(`DROP SCHEMA "${schemas[index]}" CASCADE`);
        await pool.end();
      }
    }
  });

  it('activates only a matching edge and rejects old-generation delivery after a rotated-secret fence', async () => {
    const url = process.env.TEST_DATABASE_URL!;
    const base = {
      DATABASE_URL: url,
      DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
      NODE_ENV: 'test',
      PAYGO_BOOTSTRAP_SECRET: bootstrapSecret,
      PAYGO_SYNC_ENABLED: 'true',
    };
    const hostedConfig = parseEnvironment({
      ...base,
      PAYGO_SYNC_STORE_ID: storeId,
      PAYGO_SYNC_SECRET: oldSecret,
    });
    const edgeConfig = parseEnvironment({
      ...base,
      PAYGO_RUNTIME_MODE: 'edge',
      PAYGO_STORE_ID: storeId,
      PAYGO_SYNC_SECRET: oldSecret,
      PAYGO_SYNC_URL: 'https://pos.example.test/api/sync/events',
    });
    await hosted.query(
      `INSERT INTO "user" (id,name,email,role,"emailVerified","twoFactorEnabled")
      VALUES ($1,'Manager','manager@example.test','manager',true,true)`,
      [managerId],
    );
    await hosted.query(
      `INSERT INTO session (id,"userId",token,"expiresAt","mfaVerified")
      VALUES ($1,$2,$3,now() + interval '1 hour',true)`,
      [managerSession, managerId, randomUUID()],
    );
    const authority = new StoreAuthorityService(hostedConfig, {
      connectionPool: hosted,
    });
    const snapshot = await new HostedBootstrapService(
      hostedConfig,
      { connectionPool: hosted },
      authority,
    ).publish({ userId: managerId, sessionId: managerSession });
    expect(await applyBootstrapBundle(edge, edgeConfig, snapshot)).toBe(
      'applied',
    );
    await edge.query(
      `UPDATE store_bootstrap_application SET opening_request_id = $1,
      opening_digest = $2, opening_actor_id = $3, opening_at = now() WHERE store_id = $4`,
      [randomUUID(), 'a'.repeat(64), managerId, storeId],
    );
    await edge.query(
      `UPDATE store_bootstrap_state SET opening_stock_at = now() WHERE store_id = $1`,
      [storeId],
    );
    const request = {
      requestId: randomUUID(),
      expectedGeneration: 1,
      configurationVersion: snapshot.configurationVersion,
      configurationDigest: snapshot.digest,
    };
    const issuer = new HostedCutoverService(hostedConfig, {
      connectionPool: hosted,
    });
    process.env.PAYGO_CUTOVER_ENABLED = 'false';
    await expect(
      new HostedCutoverService(hostedConfig, { connectionPool: hosted }).issue(
        { userId: managerId, sessionId: managerSession },
        'cutover',
        request,
      ),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    process.env.PAYGO_CUTOVER_ENABLED = 'true';
    await expect(
      issuer.issue(
        { userId: managerId, sessionId: randomUUID() },
        'cutover',
        request,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      issuer.issue(
        { userId: managerId, sessionId: managerSession },
        'cutover',
        { ...request, configurationDigest: 'f'.repeat(64) },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const ticket = await issuer.issue(
      { userId: managerId, sessionId: managerSession },
      'cutover',
      request,
    );
    process.env.PAYGO_CUTOVER_ENABLED = 'false';
    await expect(
      applyCutoverTicket(edge, edgeConfig, ticket),
    ).rejects.toBeInstanceOf(ConflictException);
    process.env.PAYGO_CUTOVER_ENABLED = 'true';
    await expect(
      applyCutoverTicket(edge, edgeConfig, {
        ...ticket,
        configurationDigest: 'f'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await edge.query('SELECT cutover_at FROM store_bootstrap_state')).rows[0]
        ?.cutover_at,
    ).toBeNull();
    expect(await applyCutoverTicket(edge, edgeConfig, ticket)).toBe('applied');
    expect(await applyCutoverTicket(edge, edgeConfig, ticket)).toBe(
      'duplicate',
    );
    await expect(
      issuer.issue(
        { userId: managerId, sessionId: managerSession },
        'cutover',
        { ...request, requestId: randomUUID() },
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      authority.assertWriteAllowed('operational'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      new StoreAuthorityService(edgeConfig, {
        connectionPool: edge,
      }).assertWriteAllowed('operational'),
    ).resolves.toBeUndefined();

    const eventId = randomUUID();
    const saleId = randomUUID();
    const occurredAt = new Date().toISOString();
    const payload = {
      eventId,
      storeId,
      eventType: 'cash_sale.completed',
      schemaVersion: 2,
      requestId: randomUUID(),
      saleId,
      cashierId: managerId,
      cashierName: 'Manager',
      shiftId: randomUUID(),
      occurredAt,
      totalMinor: 100,
      lines: [
        {
          productId: randomUUID(),
          name: 'Product',
          sku: 'CUT-1',
          unit: 'each',
          quantity: 1,
          priceMinor: 100,
          lineTotalMinor: 100,
        },
      ],
      payment: {
        paymentId: randomUUID(),
        amountMinor: 100,
        tenderedMinor: 100,
        changeMinor: 0,
      },
    };
    const envelope = {
      eventId,
      storeId,
      eventType: 'cash_sale.completed',
      aggregateId: saleId,
      schemaVersion: 2,
      occurredAt,
      payload,
    };
    await edge.query(
      `INSERT INTO sync_outbox
      (id,store_id,event_type,aggregate_id,schema_version,payload)
      VALUES ($1,$2,'cash_sale.completed',$3,2,$4)`,
      [eventId, storeId, saleId, JSON.stringify(payload)],
    );
    const timestamp = String(Math.floor(Date.now() / 1000));
    const headers = (
      secret: string,
      generation: number,
      value: unknown = envelope,
    ) => ({
      storeId,
      eventId,
      timestamp,
      generation: String(generation),
      signature: createSyncSignature(
        secret,
        storeId,
        eventId,
        timestamp,
        value,
        generation,
      ),
    });
    const inbox = new HostedSyncService(hostedConfig, {
      connectionPool: hosted,
    } as never);
    expect(await inbox.ingest(headers(oldSecret, 1), envelope)).toMatchObject({
      status: 'accepted',
      generation: 1,
    });
    await edge.end();
    edge = new Pool({
      ...databaseOptions(edgeConfig),
      options: `-c search_path=${schemas[1]}`,
    });
    const restored = await edge.query<{ payload: typeof payload }>(
      'SELECT payload FROM sync_outbox WHERE id = $1 AND delivered_at IS NULL',
      [eventId],
    );
    expect(restored.rowCount).toBe(1);
    const replayEnvelope = { ...envelope, payload: restored.rows[0].payload };
    const hostedNext = parseEnvironment({
      ...base,
      PAYGO_SYNC_STORE_ID: storeId,
      PAYGO_SYNC_SECRET: newSecret,
    });
    await expect(
      issuer.issue({ userId: managerId, sessionId: managerSession }, 'fence', {
        ...request,
        requestId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const edgeNext = parseEnvironment({
      ...base,
      PAYGO_RUNTIME_MODE: 'edge',
      PAYGO_STORE_ID: storeId,
      PAYGO_SYNC_SECRET: newSecret,
      PAYGO_SYNC_URL: 'https://pos.example.test/api/sync/events',
    });
    const fenceId = randomUUID();
    const fence = await new HostedCutoverService(hostedNext, {
      connectionPool: hosted,
    }).issue({ userId: managerId, sessionId: managerSession }, 'fence', {
      ...request,
      requestId: fenceId,
    });
    await expect(
      inbox.ingest(headers(oldSecret, 1), envelope),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      new HostedSyncService(hostedNext, {
        connectionPool: hosted,
      } as never).ingest(headers(newSecret, 1), envelope),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await applyCutoverTicket(edge, edgeNext, fence)).toBe('applied');
    expect(await applyCutoverTicket(edge, edgeNext, fence)).toBe('duplicate');
    expect(
      await new HostedSyncService(hostedNext, {
        connectionPool: hosted,
      } as never).ingest(headers(newSecret, 2, replayEnvelope), replayEnvelope),
    ).toMatchObject({ status: 'duplicate', generation: 2 });
    expect((await hosted.query('SELECT id FROM sync_inbox')).rowCount).toBe(1);
    expect(
      (await hosted.query('SELECT event_id FROM sync_cash_sale_projection'))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await hosted.query(`SELECT action FROM store_bootstrap_audit WHERE action IN
      ('cutover.issued','generation.fenced')`)
      ).rowCount,
    ).toBe(2);
    expect(
      (
        await edge.query(`SELECT action FROM store_bootstrap_audit WHERE action IN
      ('cutover.activated','generation.activated')`)
      ).rowCount,
    ).toBe(2);
  });
});
