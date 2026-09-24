import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Client } from 'pg';
import { runner } from 'node-pg-migrate';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';

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
    expect(await runner({ ...options, direction: 'up' })).toHaveLength(15);
    expect(await runner({ ...options, direction: 'up' })).toHaveLength(0);
    const result = await client.query<{ value: string }>(
      `SELECT value FROM "${schema}".app_metadata WHERE key = $1`,
      ['application'],
    );
    expect(result.rows).toEqual([{ value: 'pay-and-go' }]);
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
