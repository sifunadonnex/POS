import { Pool } from 'pg';
import {
  loadLocalEnvironment,
  parseEnvironment,
} from '../config/environment.js';
import { databaseOptions } from '../database/database.options.js';
import {
  bootstrapHostedManager,
  HostedManagerBootstrapError,
  parseHostedManagerInput,
} from './hosted-manager-bootstrap.js';

async function main() {
  loadLocalEnvironment();
  const config = parseEnvironment(process.env);
  if (config.nodeEnv !== 'production') {
    throw new Error('Hosted manager bootstrap requires production mode');
  }
  const input = parseHostedManagerInput(process.env);
  const pool = new Pool(databaseOptions(config));
  try {
    await bootstrapHostedManager(pool, input);
    console.log(
      'Initial hosted manager created and marked verified. Delete .local/initial-manager.env now.',
    );
  } finally {
    await pool.end();
  }
}

try {
  await main();
} catch (error) {
  const message =
    error instanceof HostedManagerBootstrapError
      ? {
          'invalid-input':
            'Bootstrap input is invalid. Check name, email format, password length (12-128), manager role and provisioned-by label.',
          'invalid-confirmation':
            'Bootstrap confirmation is invalid. Check the exact confirmation and email-control attestation values.',
          'users-exist':
            'Bootstrap refused because the hosted user table already contains an account. Do not delete it or rerun provisioning blindly.',
          database:
            'Bootstrap database write failed. The transaction was rolled back; check migrations, permissions and private server logs.',
        }[error.code]
      : 'Hosted manager bootstrap failed before provisioning. Confirm NODE_ENV=production and that the application database configuration is available to this script.';
  console.error(message);
  process.exitCode = 1;
}
