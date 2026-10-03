import { Pool } from 'pg';
import {
  loadLocalEnvironment,
  parseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from '../database/database.options.js';
import { EdgeConfigurationService } from './edge-configuration.service.js';

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = parseEnvironment(process.env);
  const pool = new Pool(databaseOptions(config));
  try {
    const service = new EdgeConfigurationService(config, {
      connectionPool: pool,
    });
    console.log(JSON.stringify(await service.checkpoint()));
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch {
  console.error('Could not read the local configuration checkpoint.');
  process.exitCode = 1;
}
