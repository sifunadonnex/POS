import type { PoolConfig } from 'pg';
import type { AppConfig } from '../config/environment.js';

export function databaseOptions(config: AppConfig): PoolConfig {
  return {
    connectionString: config.databaseUrl,
    ssl: config.databaseTls ? { rejectUnauthorized: true } : false,
    max: config.databasePoolMax,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    statement_timeout: 5000,
    query_timeout: 6000,
    application_name: 'pay-and-go',
  };
}
