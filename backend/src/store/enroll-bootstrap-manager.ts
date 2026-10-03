import { Pool } from 'pg';
import {
  loadLocalEnvironment,
  parseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from '../database/database.options.js';
import { enrollBootstrapManager } from './edge-bootstrap.service.js';

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = parseEnvironment(process.env);
  const pool = new Pool(databaseOptions(config));
  try {
    await enrollBootstrapManager(pool, config, {
      email: process.env.BOOTSTRAP_MANAGER_EMAIL ?? '',
      password: process.env.BOOTSTRAP_MANAGER_PASSWORD ?? '',
      attestIdentity: process.env.BOOTSTRAP_ATTEST_IDENTITY === 'true',
      attestEmailControl: process.env.BOOTSTRAP_ATTEST_EMAIL_CONTROL === 'true',
      witnessedBy: process.env.BOOTSTRAP_WITNESSED_BY ?? '',
    });
    console.log(
      'Local manager credential enrolled. Remove the private input file, then sign in and complete local MFA.',
    );
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch {
  console.error(
    'Local manager enrollment failed. Verify the roster, attestation and private configuration.',
  );
  process.exitCode = 1;
}
