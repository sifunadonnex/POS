import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import {
  signBootstrapBundle,
  verifyBootstrapBundle,
} from '../src/store/bootstrap-bundle.js';
import {
  applyBootstrapBundle,
  EdgeBootstrapService,
  enrollBootstrapManager,
} from '../src/store/edge-bootstrap.service.js';
import { HostedBootstrapService } from '../src/store/hosted-bootstrap.service.js';
import { StoreAuthorityService } from '../src/store/store-authority.service.js';

describe('bootstrap publication and edge apply on disposable PostgreSQL', () => {
  const storeId = randomUUID();
  const productId = randomUUID();
  const managerId = randomUUID();
  const managerSession = randomUUID();
  const secret = 'b'.repeat(48);
  const schemas = [
    `bootstrap_hosted_${randomUUID().replaceAll('-', '')}`,
    `bootstrap_edge_${randomUUID().replaceAll('-', '')}`,
  ];
  let hosted: Pool;
  let edge: Pool;
  let hostedConfig: ReturnType<typeof parseEnvironment>;
  let edgeConfig: ReturnType<typeof parseEnvironment>;
  let authority: StoreAuthorityService;
  let publisher: HostedBootstrapService;
  let edgeService: EdgeBootstrapService;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test')) {
      throw new Error('Explicit TEST_DATABASE_URL ending in _test is required');
    }
    const base = {
      DATABASE_URL: url,
      DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
      NODE_ENV: 'test',
      PAYGO_BOOTSTRAP_SECRET: secret,
      PAYGO_SYNC_ENABLED: 'true',
      PAYGO_SYNC_SECRET: 's'.repeat(48),
    };
    hostedConfig = parseEnvironment({ ...base, PAYGO_SYNC_STORE_ID: storeId });
    edgeConfig = parseEnvironment({
      ...base,
      PAYGO_RUNTIME_MODE: 'edge',
      PAYGO_STORE_ID: storeId,
      PAYGO_SYNC_URL: 'https://pos.example.test/api/sync/events',
    });
    hosted = new Pool({
      ...databaseOptions(hostedConfig),
      options: `-c search_path=${schemas[0]}`,
    });
    edge = new Pool({
      ...databaseOptions(edgeConfig),
      options: `-c search_path=${schemas[1]}`,
    });
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
    authority = new StoreAuthorityService(hostedConfig, {
      connectionPool: hosted,
    });
    publisher = new HostedBootstrapService(
      hostedConfig,
      { connectionPool: hosted },
      authority,
    );
    edgeService = new EdgeBootstrapService(edgeConfig, {
      connectionPool: edge,
    });
    await hosted.query(
      `INSERT INTO "user" (id,name,email,role,"emailVerified","twoFactorEnabled")
      VALUES ($1,'Opening Manager','opening@example.test','manager',true,true)`,
      [managerId],
    );
    await hosted.query(
      `INSERT INTO session
      (id,"userId",token,"expiresAt","mfaVerified") VALUES ($1,$2,$3,now() + interval '1 hour',true)`,
      [managerSession, managerId, randomUUID()],
    );
    await hosted.query(
      `INSERT INTO catalogue_product
      (id,sku,name,unit,price_minor,active,revision) VALUES ($1,'BOOT-1','Bootstrap item','each',1250,true,1)`,
      [productId],
    );
    await hosted.query(
      "INSERT INTO inventory_stock (product_id,unit,quantity_minor) VALUES ($1,'each',5)",
      [productId],
    );
  });

  afterAll(async () => {
    for (const [index, pool] of [hosted, edge].entries()) {
      if (pool) {
        await pool.query(`DROP SCHEMA "${schemas[index]}" CASCADE`);
        await pool.end();
      }
    }
  });

  it('requires a current manager MFA session, publishes versioned signed snapshots, and applies only once', async () => {
    await expect(
      publisher.publish({ userId: managerId, sessionId: randomUUID() }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const first = await publisher.publish({
      userId: managerId,
      sessionId: managerSession,
    });
    expect(first.configurationVersion).toBe(1);
    expect(verifyBootstrapBundle(first, secret)).toEqual(first);
    const { signature: _signature, ...unsigned } = first;
    const wrongStore = signBootstrapBundle(
      { ...unsigned, storeId: randomUUID() },
      secret,
    );
    await expect(
      applyBootstrapBundle(edge, edgeConfig, wrongStore),
    ).rejects.toBeInstanceOf(ConflictException);
    const replacement = signBootstrapBundle(
      { ...unsigned, generation: 2 },
      secret,
    );
    await expect(
      applyBootstrapBundle(edge, edgeConfig, replacement),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (
        await publisher.publish({
          userId: managerId,
          sessionId: managerSession,
        })
      ).configurationVersion,
    ).toBe(1);
    await expect(
      applyBootstrapBundle(edge, edgeConfig, {
        ...first,
        storeId: randomUUID(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      applyBootstrapBundle(edge, edgeConfig, {
        ...first,
        payload: {
          ...first.payload,
          proposedStock: [{ productId, quantityMinor: '500' }],
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      applyBootstrapBundle(edge, edgeConfig, {
        ...first,
        expiresAt: new Date(0).toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect((await edge.query('SELECT id FROM "user"')).rowCount).toBe(0);
    expect(await applyBootstrapBundle(edge, edgeConfig, first)).toBe('applied');
    expect(await applyBootstrapBundle(edge, edgeConfig, first)).toBe(
      'duplicate',
    );
    const second = await publisher.publish({
      userId: managerId,
      sessionId: managerSession,
    });
    await expect(
      applyBootstrapBundle(edge, edgeConfig, second),
    ).rejects.toBeInstanceOf(ConflictException);
    await hosted.query(
      'UPDATE catalogue_product SET price_minor = 1300 WHERE id = $1',
      [productId],
    );
    await expect(
      publisher.publish({
        userId: managerId,
        sessionId: managerSession,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (
        await hosted.query<{ configuration_version: string }>(
          'SELECT configuration_version FROM store_bootstrap_state',
        )
      ).rows[0]?.configuration_version,
    ).toBe('2');
    expect(
      (await edge.query('SELECT id FROM catalogue_product')).rowCount,
    ).toBe(1);
    await expect(
      new StoreAuthorityService(edgeConfig, {
        connectionPool: edge,
      }).assertWriteAllowed('operational'),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('enrolls only the published manager and atomically signs counted opening stock', async () => {
    await expect(
      enrollBootstrapManager(
        edge,
        edgeConfig,
        {
          email: 'other@example.test',
          password: 'a'.repeat(16),
          attestIdentity: true,
          attestEmailControl: true,
          witnessedBy: 'Test witness',
        },
        async () => 'test-hash',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await enrollBootstrapManager(
      edge,
      edgeConfig,
      {
        email: 'opening@example.test',
        password: 'a'.repeat(16),
        attestIdentity: true,
        attestEmailControl: true,
        witnessedBy: 'Test witness',
      },
      async () => 'test-hash',
    );
    await expect(
      enrollBootstrapManager(
        edge,
        edgeConfig,
        {
          email: 'opening@example.test',
          password: 'a'.repeat(16),
          attestIdentity: true,
          attestEmailControl: true,
          witnessedBy: 'Test witness',
        },
        async () => 'test-hash',
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const edgeSession = randomUUID();
    await edge.query(
      'UPDATE "user" SET "twoFactorEnabled" = true WHERE id = $1',
      [managerId],
    );
    await edge.query(
      `INSERT INTO session (id,"userId",token,"expiresAt","mfaVerified")
      VALUES ($1,$2,$3,now() + interval '1 hour',true)`,
      [edgeSession, managerId, randomUUID()],
    );
    const actor = { userId: managerId, sessionId: edgeSession };
    const requestId = randomUUID();
    await expect(
      edgeService.signOffOpening(
        { userId: managerId, sessionId: randomUUID() },
        { requestId, counts: [{ productId, quantityMinor: '7' }] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      edgeService.signOffOpening(actor, { requestId, counts: [] }),
    ).rejects.toThrow();
    expect(
      (await edge.query('SELECT product_id FROM inventory_stock')).rowCount,
    ).toBe(0);
    expect(
      await edgeService.signOffOpening(actor, {
        requestId,
        counts: [{ productId, quantityMinor: '7' }],
      }),
    ).toEqual({ status: 'applied' });
    expect(
      await edgeService.signOffOpening(actor, {
        requestId,
        counts: [{ productId, quantityMinor: '7' }],
      }),
    ).toEqual({ status: 'duplicate' });
    await expect(
      edgeService.signOffOpening(actor, {
        requestId: randomUUID(),
        counts: [{ productId, quantityMinor: '8' }],
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      (await edge.query('SELECT id FROM inventory_movement')).rowCount,
    ).toBe(1);
    const stock = await edge.query<{ quantity_minor: string }>(
      'SELECT quantity_minor FROM inventory_stock',
    );
    expect(stock.rows[0]?.quantity_minor).toBe('7');
    const audit = await edge.query<{ detail: { variance: unknown[] } }>(
      `SELECT detail FROM store_bootstrap_audit WHERE action = 'opening.signed-off'`,
    );
    expect(audit.rowCount).toBe(1);
    expect(audit.rows[0]?.detail.variance).toEqual([
      { productId, proposedMinor: '5', countedMinor: '7' },
    ]);
    await expect(
      edge.query(
        `UPDATE store_bootstrap_application
      SET opening_request_id = $1 WHERE store_id = $2`,
        [randomUUID(), storeId],
      ),
    ).rejects.toThrow();
    await expect(
      edge.query(
        `UPDATE store_bootstrap_state SET opening_stock_at = NULL
      WHERE store_id = $1`,
        [storeId],
      ),
    ).rejects.toThrow();
    await expect(
      new StoreAuthorityService(edgeConfig, {
        connectionPool: edge,
      }).assertWriteAllowed('operational'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
