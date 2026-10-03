import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import {
  loadLocalEnvironment,
  parseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from '../database/database.options.js';
import { applyBootstrapBundle } from './edge-bootstrap.service.js';

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = parseEnvironment(process.env);
  const path = process.argv[2];
  if (!path || process.argv.length !== 3)
    throw new Error('Provide one private bundle file path');
  const file = await readFile(path);
  if (file.byteLength > 8_000_000) throw new Error('Bundle file exceeds 8 MB');
  const bundle: unknown = JSON.parse(file.toString('utf8'));
  const pool = new Pool(databaseOptions(config));
  try {
    const result = await applyBootstrapBundle(pool, config, bundle);
    console.log(
      `Edge bootstrap ${result}; local manager enrollment and opening stock signoff are still required.`,
    );
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch {
  console.error(
    'Edge bootstrap failed. Verify the private bundle, store configuration and database state; no partial apply was committed.',
  );
  process.exitCode = 1;
}
