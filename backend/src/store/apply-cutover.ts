import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import {
  loadLocalEnvironment,
  parseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from '../database/database.options.js';
import { applyCutoverTicket } from './edge-cutover.js';

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = parseEnvironment(process.env);
  const path = process.argv[2];
  if (!path || process.argv.length !== 3)
    throw new Error('Provide one private ticket file path');
  const file = await readFile(path);
  if (file.byteLength > 16_384) throw new Error('Cutover ticket exceeds 16 KB');
  const ticket: unknown = JSON.parse(file.toString('utf8'));
  const pool = new Pool(databaseOptions(config));
  try {
    console.log(
      `Cutover ticket ${await applyCutoverTicket(pool, config, ticket)}.`,
    );
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch {
  console.error('Cutover ticket failed; local authority was not activated.');
  process.exitCode = 1;
}
