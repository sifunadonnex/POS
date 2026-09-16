import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { DatabaseService } from '../src/database/database.service.js';
import { CatalogueService } from '../src/catalogue/catalogue.service.js';
import { CatalogueWrites } from '../src/catalogue/catalogue-writes.js';
import { CatalogueImportService } from '../src/catalogue/catalogue-import.service.js';

// Uses only a disposable schema in an explicit _test database.
describe('catalogue PostgreSQL transactions', () => {
  let pool: Pool, catalogue: CatalogueService, importer: CatalogueImportService;
  const schema = `catalogue_${randomUUID().replaceAll('-', '')}`;
  const actor = { userId: randomUUID(), sessionId: randomUUID() };
  const base = {
    sku: 'RICE',
    name: 'Loose rice',
    categoryId: null,
    unit: 'kg',
    price: '180.05',
    barcodes: ['0012345'],
    taxCode: null,
    active: true,
    reason: 'Test opening catalogue',
  };
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Explicit TEST_DATABASE_URL ending in _test is required');
    const config = parseEnvironment({
      DATABASE_URL: url,
      DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
      NODE_ENV: 'test',
    });
    pool = new Pool({
      ...databaseOptions(config),
      options: `-c search_path=${schema}`,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const client = await pool.connect();
    try {
      await runner({
        dbClient: client,
        dir: fileURLToPath(new URL('../migrations/', import.meta.url)),
        schema,
        migrationsSchema: schema,
        migrationsTable: 'pgmigrations',
        direction: 'up',
        singleTransaction: true,
        log: () => undefined,
      });
    } finally {
      client.release();
    }
    await pool.query(
      'INSERT INTO "user" (id, name, email, role, "emailVerified", "twoFactorEnabled") VALUES ($1, $2, $3, $4, true, true)',
      [
        actor.userId,
        'Catalogue test manager',
        'catalogue@example.test',
        'manager',
      ],
    );
    await pool.query(
      'INSERT INTO session (id, "userId", token, "expiresAt", "mfaVerified") VALUES ($1, $2, $3, now() + interval \'1 hour\', true)',
      [actor.sessionId, actor.userId, randomUUID()],
    );
    const fixture = await Test.createTestingModule({
      providers: [
        CatalogueService,
        CatalogueWrites,
        CatalogueImportService,
        { provide: DatabaseService, useValue: { connectionPool: pool } },
      ],
    }).compile();
    catalogue = fixture.get(CatalogueService);
    importer = fixture.get(CatalogueImportService);
  });
  afterAll(async () => {
    if (pool) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await pool.end();
      }
    }
  });

  it('commits concurrent retries once and rejects changed-content reuse', async () => {
    const requestId = randomUUID();
    const responses = await Promise.all([
      catalogue.createProduct(actor, { ...base, requestId }),
      catalogue.createProduct(actor, { ...base, requestId }),
    ]);
    expect(responses[0]).toEqual(responses[1]);
    expect(
      (await pool.query('SELECT sku, price_minor::text FROM catalogue_product'))
        .rows,
    ).toEqual([{ sku: 'RICE', price_minor: '18005' }]);
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM catalogue_history'))
        .rows[0].count,
    ).toBe(1);
    await expect(
      catalogue.createProduct(actor, { ...base, requestId, price: '200' }),
    ).rejects.toThrow('different change');
  });

  it('rolls back duplicate barcodes and preserves old prices while rejecting stale updates', async () => {
    await expect(
      catalogue.createProduct(actor, {
        ...base,
        sku: 'SECOND',
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('already in use');
    expect(
      (await pool.query('SELECT count(*)::int AS count FROM catalogue_product'))
        .rows[0].count,
    ).toBe(1);
    const row = (
      await pool.query<{ id: string }>(
        'SELECT id FROM catalogue_product WHERE sku = $1',
        ['RICE'],
      )
    ).rows[0];
    await catalogue.updateProduct(actor, row.id, {
      ...base,
      price: '200.00',
      revision: 1,
      requestId: randomUUID(),
    });
    await expect(
      catalogue.updateProduct(actor, row.id, {
        ...base,
        price: '220.00',
        revision: 1,
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('product changed');
    const history = await pool.query<{ price: string }>(
      "SELECT snapshot->>'priceMinor' AS price FROM catalogue_history WHERE entity_id = $1 ORDER BY revision",
      [row.id],
    );
    expect(history.rows.map((entry) => entry.price)).toEqual([
      '18005',
      '20000',
    ]);
    await expect(
      pool.query('UPDATE catalogue_history SET reason = $1', [
        'Changed history',
      ]),
    ).rejects.toThrow('append-only');
  });

  it('imports a complete valid batch once and rejects a mixed invalid batch atomically', async () => {
    const csv =
        'sku,name,category,unit,price,barcodes,tax_code\nOIL,Loose oil,,l,250.05,00077,\nSOAP,Soap pack,,pack,120,,',
      requestId = randomUUID();
    expect((await importer.preview({ csv })).canImport).toBe(true);
    const original = await importer.import(actor, {
      csv,
      requestId,
      reason: 'Test import',
    });
    expect(
      await importer.import(actor, { csv, requestId, reason: 'Test import' }),
    ).toEqual(original);
    const invalid =
      'sku,name,category,unit,price,barcodes,tax_code\nNEW,New item,,each,10,,\nOIL,Duplicate oil,,l,10,,';
    await expect(
      importer.import(actor, {
        csv: invalid,
        requestId: randomUUID(),
        reason: 'Test rejected import',
      }),
    ).rejects.toThrow('validation');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM catalogue_product WHERE sku = $1',
          ['NEW'],
        )
      ).rows[0].count,
    ).toBe(0);
  });

  it('archives a product without losing its history or allowing barcode reuse', async () => {
    const row = (
      await pool.query<{ id: string }>(
        'SELECT id FROM catalogue_product WHERE sku = $1',
        ['RICE'],
      )
    ).rows[0];
    await catalogue.updateProduct(actor, row.id, {
      ...base,
      price: '200.00',
      active: false,
      revision: 2,
      requestId: randomUUID(),
    });
    expect(
      (await catalogue.products({ search: 'RICE' }, false)).products,
    ).toEqual([]);
    expect(
      (await catalogue.products({ search: 'RICE', status: 'archived' }, true))
        .products,
    ).toHaveLength(1);
    await expect(catalogue.barcode('0012345')).rejects.toThrow(
      'No active product',
    );
    expect((await catalogue.history(row.id, '0')).history).toHaveLength(3);
    await expect(
      catalogue.createProduct(actor, {
        ...base,
        sku: 'REUSED',
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('already in use');
  });

  it('checks current session assurance inside each write transaction', async () => {
    await pool.query('UPDATE session SET "mfaVerified" = false WHERE id = $1', [
      actor.sessionId,
    ]);
    await expect(
      catalogue.createProduct(actor, {
        ...base,
        sku: 'DENIED',
        barcodes: [],
        requestId: randomUUID(),
      }),
    ).rejects.toThrow('manager access');
    expect(
      (
        await pool.query(
          'SELECT count(*)::int AS count FROM catalogue_product WHERE sku = $1',
          ['DENIED'],
        )
      ).rows[0].count,
    ).toBe(0);
  });
});
