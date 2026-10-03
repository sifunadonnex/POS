import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ConflictException } from '@nestjs/common';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { StoreAuthorityService } from '../src/store/store-authority.service.js';

describe('store authority on disposable PostgreSQL', () => {
  let pool: Pool;
  let authority: StoreAuthorityService;
  const schema = `store_${randomUUID().replaceAll('-', '')}`;
  const storeId = randomUUID();

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test')) {
      throw new Error('Explicit TEST_DATABASE_URL ending in _test is required');
    }
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
    authority = new StoreAuthorityService(config, { connectionPool: pool });
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  });

  it('registers one store and advances only contiguous, matching checkpoints', async () => {
    await authority.initialize(storeId);
    await authority.initialize(storeId);
    await expect(authority.initialize(randomUUID())).rejects.toBeInstanceOf(
      ConflictException,
    );
    const digest = 'a'.repeat(64);
    expect(await authority.advanceConfiguration(storeId, 1, 0, 1, digest)).toBe(
      'applied',
    );
    expect(await authority.advanceConfiguration(storeId, 1, 0, 1, digest)).toBe(
      'duplicate',
    );
    await expect(
      authority.advanceConfiguration(storeId, 1, 0, 1, 'b'.repeat(64)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      authority.advanceConfiguration(storeId, 1, 1, 3, 'b'.repeat(64)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      authority.advanceConfiguration(storeId, 2, 1, 2, 'b'.repeat(64)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      authority.advanceConfiguration(
        storeId,
        1,
        1,
        2,
        'b'.repeat(64),
        async (client) => {
          await client.query(
            "INSERT INTO catalogue_category (id, name) VALUES ($1, 'rolled back')",
            [randomUUID()],
          );
          throw new Error('apply failed');
        },
      ),
    ).rejects.toThrow('apply failed');
    const row = await pool.query<{
      configuration_version: string;
      configuration_digest: string;
    }>(
      'SELECT configuration_version::text, configuration_digest FROM store_bootstrap_state',
    );
    expect(row.rows[0]).toEqual({
      configuration_version: '1',
      configuration_digest: digest,
    });
    expect(
      (await pool.query('SELECT id FROM catalogue_category')).rowCount,
    ).toBe(0);
  });

  it('blocks cutover while a shift is open and fences stale generations', async () => {
    const userId = `manager-${randomUUID()}`;
    await pool.query(
      'INSERT INTO "user" (id, name, email) VALUES ($1, $2, $3)',
      [userId, 'Manager', `${randomUUID()}@example.test`],
    );
    const shiftId = randomUUID();
    await pool.query(
      `INSERT INTO cash_shift (id, cashier_id, opening_cash_minor, status, reason)
       VALUES ($1, $2, 0, 'open', 'test opening')`,
      [shiftId, userId],
    );
    const cutoverId = randomUUID();
    await expect(authority.cutOver(storeId, cutoverId)).rejects.toBeInstanceOf(
      ConflictException,
    );
    await pool.query(
      `UPDATE cash_shift SET status = 'closed', closing_cash_minor = 0,
       variance_minor = 0, closed_at = now() WHERE id = $1`,
      [shiftId],
    );
    expect(await authority.cutOver(storeId, cutoverId)).toBe('applied');
    expect(await authority.cutOver(storeId, cutoverId)).toBe('duplicate');
    await expect(
      authority.cutOver(storeId, randomUUID()),
    ).rejects.toBeInstanceOf(ConflictException);

    const nextSale = () =>
      pool.query(
        `INSERT INTO sale (id, actor_id, total_minor, status, reason)
         VALUES ($1, $2, 0, 'completed', 'test sale')`,
        [randomUUID(), userId],
      );
    await expect(nextSale()).rejects.toMatchObject({ code: '42501' });
    await expect(
      pool.query(
        `INSERT INTO inventory_stock (product_id, unit, quantity_minor)
         VALUES ($1, 'each', 1)`,
        [randomUUID()],
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      authority.assertWriteAllowed('operational'),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      authority.assertWriteAllowed('central'),
    ).resolves.toBeUndefined();

    const fenceId = randomUUID();
    expect(await authority.fenceGeneration(storeId, 1, fenceId)).toEqual({
      generation: 2,
      status: 'applied',
    });
    expect(await authority.fenceGeneration(storeId, 1, fenceId)).toEqual({
      generation: 2,
      status: 'duplicate',
    });
    await expect(
      authority.fenceGeneration(storeId, 1, randomUUID()),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      authority.advanceConfiguration(storeId, 1, 1, 2, 'b'.repeat(64)),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      pool.query(
        "UPDATE store_bootstrap_state SET checkout_authority = 'hosted' WHERE singleton",
      ),
    ).rejects.toThrow();
    await expect(
      pool.query('DELETE FROM store_bootstrap_state WHERE singleton'),
    ).rejects.toThrow();
  });
});
