import { fileURLToPath } from 'node:url';
import { runner } from 'node-pg-migrate';
import {
  loadLocalEnvironment,
  parseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from './database.options.js';

try {
  loadLocalEnvironment();
  const config = parseEnvironment(process.env);
  const direction = process.argv[2];
  if (direction !== 'up' && direction !== 'down') {
    throw new Error('Expected up or down');
  }
  if (
    direction === 'down' &&
    (config.nodeEnv === 'production' ||
      process.argv[3] !== '--confirm-rollback')
  ) {
    throw new Error(
      'Rollback requires non-production mode and --confirm-rollback',
    );
  }
  await runner({
    databaseUrl: {
      ...databaseOptions(config),
      statement_timeout: 60000,
      query_timeout: 65000,
    },
    dir: fileURLToPath(new URL('../../migrations/', import.meta.url)),
    migrationsTable: 'pgmigrations',
    direction,
    count: direction === 'down' ? 1 : undefined,
    checkOrder: true,
    singleTransaction: true,
    noLock: false,
    log: () => undefined,
  });
  console.info('Database migration completed');
} catch {
  console.error(
    'Database migration failed. Check configuration, connectivity, permissions and migration order. Rollback requires non-production mode and --confirm-rollback.',
  );
  process.exitCode = 1;
}
