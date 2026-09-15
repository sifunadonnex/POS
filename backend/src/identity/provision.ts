import { Pool } from 'pg';
import {
  loadLocalEnvironment,
  parseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from '../database/database.options.js';
import { parseStaffInput, provisionStaff } from './provision-staff.js';

async function main() {
  loadLocalEnvironment();
  const config = parseEnvironment(process.env);
  const url = new URL(config.databaseUrl);
  if (
    config.nodeEnv === 'production' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    !/_dev$|_test$/.test(url.pathname)
  ) {
    throw new Error(
      'This provisioning command is restricted to local development/test databases',
    );
  }
  const input = parseStaffInput(process.env);
  const pool = new Pool(databaseOptions(config));
  try {
    await provisionStaff(pool, input);
    console.log('Staff account created. No credentials are printed.');
  } finally {
    await pool.end();
  }
}
try {
  await main();
} catch {
  console.error(
    'Staff provisioning failed. Check local configuration, input and migrations.',
  );
  process.exitCode = 1;
}
