import { Pool } from 'pg';
import {
  loadLocalEnvironment,
  parseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from '../database/database.options.js';
import { redeemEdgeStaffGrant } from './edge-staff-enrollment.service.js';

async function main(): Promise<void> {
  loadLocalEnvironment();
  const config = parseEnvironment(process.env);
  const pool = new Pool(databaseOptions(config));
  try {
    await redeemEdgeStaffGrant(pool, config, {
      token: process.env.EDGE_STAFF_GRANT_TOKEN ?? '',
      email: process.env.EDGE_STAFF_EMAIL ?? '',
      password: process.env.EDGE_STAFF_PASSWORD ?? '',
      attestIdentity: process.env.EDGE_STAFF_ATTEST_IDENTITY === 'true',
      attestEmailControl:
        process.env.EDGE_STAFF_ATTEST_EMAIL_CONTROL === 'true',
      witnessedBy: process.env.EDGE_STAFF_WITNESSED_BY ?? '',
    });
    console.log(
      'Local staff credential enrolled. Remove the private input file.',
    );
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch {
  console.error(
    'Local staff enrollment failed. Verify the grant, roster, attestations and private configuration.',
  );
  process.exitCode = 1;
}
