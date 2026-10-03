import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ConflictException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { CatalogueImportService } from '../src/catalogue/catalogue-import.service.js';
import { CatalogueWrites } from '../src/catalogue/catalogue-writes.js';
import { parseEnvironment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';
import { databaseOptions } from '../src/database/database.options.js';
import { signConfigurationBatch } from '../src/store/configuration-batch.js';
import { applyBootstrapBundle } from '../src/store/edge-bootstrap.service.js';
import {
  applyConfigurationBatch,
  EdgeConfigurationService,
} from '../src/store/edge-configuration.service.js';
import { HostedBootstrapService } from '../src/store/hosted-bootstrap.service.js';
import { HostedConfigurationService } from '../src/store/hosted-configuration.service.js';
import { StoreAuthorityService } from '../src/store/store-authority.service.js';
import { SecurityStore } from '../src/identity/security-store.js';

describe('ordered configuration journal on disposable PostgreSQL', () => {
  const storeId = randomUUID();
  const managerId = randomUUID();
  const cashierId = randomUUID();
  const sessionId = randomUUID();
  const secret = 'b'.repeat(48);
  const schemas = [
    `cfg_hosted_${randomUUID().replaceAll('-', '')}`,
    `cfg_edge_${randomUUID().replaceAll('-', '')}`,
    `cfg_stale_${randomUUID().replaceAll('-', '')}`,
  ];
  let hosted: Pool;
  let edge: Pool;
  let stale: Pool;
  let importer: CatalogueImportService;
  let hostedConfig: ReturnType<typeof parseEnvironment>;
  let edgeConfig: ReturnType<typeof parseEnvironment>;
  let publisher: HostedBootstrapService;
  let changes: HostedConfigurationService;
  let initialDigest: string;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Explicit _test database required');
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
    stale = new Pool({
      ...databaseOptions(edgeConfig),
      options: `-c search_path=${schemas[2]}`,
    });
    for (const [index, pool] of [hosted, edge, stale].entries()) {
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
    await hosted.query(
      `INSERT INTO "user" (id,name,email,role,"emailVerified","twoFactorEnabled")
      VALUES ($1,'Manager','manager@example.test','manager',true,true),
        ($2,'Cashier','cashier@example.test','cashier',true,false)`,
      [managerId, cashierId],
    );
    await hosted.query(
      `INSERT INTO session (id,"userId",token,"expiresAt","mfaVerified")
      VALUES ($1,$2,$3,now() + interval '1 hour',true)`,
      [sessionId, managerId, randomUUID()],
    );
    const authority = new StoreAuthorityService(hostedConfig, {
      connectionPool: hosted,
    });
    publisher = new HostedBootstrapService(
      hostedConfig,
      { connectionPool: hosted },
      authority,
    );
    changes = new HostedConfigurationService(hostedConfig, {
      connectionPool: hosted,
    });
    const fixture = await Test.createTestingModule({
      providers: [
        CatalogueWrites,
        CatalogueImportService,
        { provide: DatabaseService, useValue: { connectionPool: hosted } },
      ],
    }).compile();
    importer = fixture.get(CatalogueImportService);
    const snapshot = await publisher.publish({ userId: managerId, sessionId });
    initialDigest = snapshot.digest;
    expect(await applyBootstrapBundle(edge, edgeConfig, snapshot)).toBe(
      'applied',
    );
  });

  afterAll(async () => {
    for (const [index, pool] of [hosted, edge, stale].entries()) {
      if (pool) {
        await pool.query(`DROP SCHEMA "${schemas[index]}" CASCADE`);
        await pool.end();
      }
    }
  });

  it('journals a CSV transaction in commit order and applies a contiguous edge batch', async () => {
    const csv =
      'sku,name,category,unit,price,barcodes,tax_code\nCFG-A,Config A,,each,10,A-001,\nCFG-B,Config B,,pack,20,B-001,';
    await importer.import(
      { userId: managerId, sessionId },
      { csv, requestId: randomUUID(), reason: 'Initial catalogue import' },
    );
    const journal = await hosted.query<{
      version: string;
      transaction_id: string;
      actor_id: string;
      reason: string;
    }>(
      'SELECT version::text, transaction_id::text, actor_id, reason FROM store_configuration_journal ORDER BY version',
    );
    expect(journal.rowCount).toBe(4);
    expect(new Set(journal.rows.map((row) => row.transaction_id)).size).toBe(1);
    expect(journal.rows.map((row) => row.version)).toEqual([
      '2',
      '3',
      '4',
      '5',
    ]);
    expect(
      journal.rows.every(
        (row) =>
          row.actor_id === managerId &&
          row.reason === 'Initial catalogue import',
      ),
    ).toBe(true);
    const edgeCashierSession = randomUUID();
    await edge.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [
      cashierId,
    ]);
    await edge.query(
      `INSERT INTO session (id,"userId",token,"expiresAt")
      VALUES ($1,$2,$3,now() + interval '1 hour')`,
      [edgeCashierSession, cashierId, randomUUID()],
    );
    await hosted.query('UPDATE "user" SET disabled = true WHERE id = $1', [
      cashierId,
    ]);
    const actor = { userId: managerId, sessionId };
    await expect(
      changes.publishChanges(actor, {
        afterVersion: 1,
        afterDigest: 'f'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    const batch = await changes.publishChanges(actor, {
      afterVersion: 1,
      afterDigest: initialDigest,
    });
    expect(batch.events.length).toBe(5);
    expect(batch.events[4].entity).toBe('staff');
    await expect(
      applyConfigurationBatch(edge, edgeConfig, {
        ...batch,
        toDigest: 'f'.repeat(64),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(await applyConfigurationBatch(edge, edgeConfig, batch)).toBe(
      'applied',
    );
    expect(await applyConfigurationBatch(edge, edgeConfig, batch)).toBe(
      'duplicate',
    );
    expect(
      (await edge.query('SELECT id FROM catalogue_product')).rowCount,
    ).toBe(2);
    expect(
      (await edge.query('SELECT code FROM catalogue_barcode')).rowCount,
    ).toBe(2);
    expect(
      (
        await edge.query('SELECT id FROM session WHERE id = $1', [
          edgeCashierSession,
        ])
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await edge.query<{ disabled: boolean }>(
          'SELECT disabled FROM "user" WHERE id = $1',
          [cashierId],
        )
      ).rows[0]?.disabled,
    ).toBe(true);
    expect(
      (await edge.query('SELECT version FROM store_configuration_applied'))
        .rowCount,
    ).toBe(5);
    await expect(
      applyConfigurationBatch(
        edge,
        edgeConfig,
        signConfigurationBatch({ ...batch, fromVersion: 2 }, secret),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    const heartbeat = await changes.publishChanges(actor, {
      afterVersion: batch.toVersion,
      afterDigest: batch.toDigest,
    });
    expect(heartbeat.events).toEqual([]);
    expect(await applyConfigurationBatch(edge, edgeConfig, heartbeat)).toBe(
      'applied',
    );
  });

  it('orders concurrent commits and rolls back a corrupt edge batch without advancing its cursor', async () => {
    const before = await edge.query<{
      configuration_version: string;
      configuration_digest: string;
    }>(
      'SELECT configuration_version::text, configuration_digest FROM store_bootstrap_state',
    );
    const cursor = before.rows[0];
    const firstId = randomUUID();
    const secondId = randomUUID();
    const first = await hosted.connect();
    const second = await hosted.connect();
    try {
      await first.query('BEGIN');
      await first.query(
        `INSERT INTO catalogue_product
        (id,sku,name,unit,price_minor) VALUES ($1,'CONC-A','Concurrent A','each',100)`,
        [firstId],
      );
      await second.query('BEGIN');
      const pendingSecond = second.query(
        `INSERT INTO catalogue_product
        (id,sku,name,unit,price_minor) VALUES ($1,'CONC-B','Concurrent B','each',200)`,
        [secondId],
      );
      await first.query('COMMIT');
      await pendingSecond;
      await second.query('COMMIT');
    } finally {
      first.release();
      second.release();
    }
    const batch = await changes.publishChanges(
      { userId: managerId, sessionId },
      {
        afterVersion: Number(cursor.configuration_version),
        afterDigest: cursor.configuration_digest,
      },
    );
    expect(batch.events.map((event) => event.entityId)).toEqual([
      firstId,
      secondId,
    ]);
    expect(batch.events[0].transactionId).not.toBe(
      batch.events[1].transactionId,
    );
    const gap = signConfigurationBatch(
      { ...batch, events: [batch.events[1]] },
      secret,
    );
    await expect(
      applyConfigurationBatch(edge, edgeConfig, gap),
    ).rejects.toBeInstanceOf(ConflictException);
    const corrupt = signConfigurationBatch(
      {
        ...batch,
        events: [
          batch.events[0],
          {
            ...batch.events[1],
            payload: {
              ...batch.events[1].payload,
              categoryId: randomUUID(),
            },
          },
        ],
      },
      secret,
    );
    await expect(
      applyConfigurationBatch(edge, edgeConfig, corrupt),
    ).rejects.toThrow();
    expect(
      (
        await edge.query(
          'SELECT id FROM catalogue_product WHERE id = ANY($1::uuid[])',
          [[firstId, secondId]],
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (
        await edge.query<{ configuration_version: string }>(
          'SELECT configuration_version::text FROM store_bootstrap_state',
        )
      ).rows[0]?.configuration_version,
    ).toBe(cursor.configuration_version);
    expect(await applyConfigurationBatch(edge, edgeConfig, batch)).toBe(
      'applied',
    );
    expect(
      (
        await edge.query(
          'SELECT id FROM catalogue_product WHERE id = ANY($1::uuid[])',
          [[firstId, secondId]],
        )
      ).rowCount,
    ).toBe(2);
  });

  it('fails closed for existing sessions and new logins after a backward clock', async () => {
    await edge.query(
      `UPDATE store_bootstrap_state SET opening_stock_at = now(),
      cutover_at = now(), cutover_request_id = $1 WHERE store_id = $2`,
      [randomUUID(), storeId],
    );
    const authority = new StoreAuthorityService(edgeConfig, {
      connectionPool: edge,
    });
    await expect(
      authority.assertWriteAllowed('operational'),
    ).resolves.toBeUndefined();
    const managerEdgeSession = randomUUID();
    await edge.query('UPDATE "user" SET "emailVerified" = true WHERE id = $1', [
      managerId,
    ]);
    await edge.query(
      `INSERT INTO session (id,"userId",token,"expiresAt","mfaVerified")
      VALUES ($1,$2,$3,now() + interval '1 hour',true)`,
      [managerEdgeSession, managerId, randomUUID()],
    );
    await edge.query(
      `UPDATE store_bootstrap_state
      SET last_roster_check_at = now() + interval '1 hour' WHERE store_id = $1`,
      [storeId],
    );
    await expect(
      authority.assertWriteAllowed('operational'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      edge.query(
        `INSERT INTO session (id,"userId",token,"expiresAt")
      VALUES ($1,$2,$3,now() + interval '1 hour')`,
        [randomUUID(), managerId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      new SecurityStore(edge, true).requireActive({
        user: {
          id: managerId,
          role: 'manager',
          disabled: false,
          emailVerified: true,
        },
        session: {
          id: managerEdgeSession,
          mfaVerified: true,
          lastActivityAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    expect(
      (
        await edge.query('SELECT id FROM session WHERE id = $1', [
          managerEdgeSession,
        ])
      ).rowCount,
    ).toBe(0);
  });

  it('expires the roster after 24 hours and reopens it only with a signed check', async () => {
    await stale.query(
      `INSERT INTO "user" (id,name,email,role,"emailVerified")
        VALUES ($1,'Stale Manager','stale@example.test','manager',true)`,
      [managerId],
    );
    const existingSession = randomUUID();
    await stale.query(
      `INSERT INTO session (id,"userId",token,"expiresAt")
      VALUES ($1,$2,$3,now() + interval '1 hour')`,
      [existingSession, managerId, randomUUID()],
    );
    await stale.query(
      `INSERT INTO store_bootstrap_state
      (store_id,runtime_mode,checkout_authority,configuration_version,
       configuration_digest,opening_stock_at,cutover_at,cutover_request_id,
       last_roster_check_at)
      VALUES ($1,'edge','local',1,$2,now(),now(),$3,now() - interval '25 hours')`,
      [storeId, initialDigest, randomUUID()],
    );
    await stale.query(
      `INSERT INTO store_bootstrap_application
      (store_id,publication_id,digest,publisher_id,snapshot_payload,proposed_stock)
      VALUES ($1,$2,$3,$4,'{}'::jsonb,'[]'::jsonb)`,
      [storeId, randomUUID(), initialDigest, managerId],
    );
    const authority = new StoreAuthorityService(edgeConfig, {
      connectionPool: stale,
    });
    expect(
      (
        await new EdgeConfigurationService(edgeConfig, {
          connectionPool: stale,
        }).checkpoint()
      ).version,
    ).toBe(1);
    await expect(
      authority.assertWriteAllowed('operational'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      stale.query(
        `INSERT INTO session (id,"userId",token,"expiresAt")
      VALUES ($1,$2,$3,now() + interval '1 hour')`,
        [randomUUID(), managerId, randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      new SecurityStore(stale, true).requireActive({
        user: {
          id: managerId,
          role: 'manager',
          disabled: false,
          emailVerified: true,
        },
        session: {
          id: existingSession,
          mfaVerified: true,
          lastActivityAt: new Date(),
        },
      }),
    ).rejects.toThrow();
    const issuedAt = new Date();
    const check = signConfigurationBatch(
      {
        schemaVersion: 1,
        storeId,
        generation: 1,
        fromVersion: 1,
        toVersion: 1,
        fromDigest: initialDigest,
        toDigest: initialDigest,
        events: [],
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 15 * 60_000).toISOString(),
      },
      secret,
    );
    expect(await applyConfigurationBatch(stale, edgeConfig, check)).toBe(
      'applied',
    );
    await expect(
      authority.assertWriteAllowed('operational'),
    ).resolves.toBeUndefined();
    await expect(
      stale.query(
        `UPDATE store_bootstrap_state
      SET last_roster_check_at = NULL WHERE store_id = $1`,
        [storeId],
      ),
    ).rejects.toThrow();
  });
});
