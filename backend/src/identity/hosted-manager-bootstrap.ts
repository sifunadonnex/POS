import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Pool } from 'pg';
import { parseStaffInput } from './provision-staff.js';

const confirmation = 'CREATE_INITIAL_VERIFIED_MANAGER';

export type HostedManagerBootstrapErrorCode =
  'invalid-input' | 'invalid-confirmation' | 'users-exist' | 'database';

export class HostedManagerBootstrapError extends Error {
  constructor(readonly code: HostedManagerBootstrapErrorCode) {
    super(code);
  }
}

export function parseHostedManagerInput(env: NodeJS.ProcessEnv) {
  let input: ReturnType<typeof parseStaffInput>;
  try {
    input = parseStaffInput(env);
  } catch {
    throw new HostedManagerBootstrapError('invalid-input');
  }
  if (
    input.role !== 'manager' ||
    env.STAFF_BOOTSTRAP_CONFIRM !== confirmation ||
    env.STAFF_BOOTSTRAP_ATTEST_EMAIL_CONTROL !== 'true'
  ) {
    throw new HostedManagerBootstrapError('invalid-confirmation');
  }
  return input;
}

export async function bootstrapHostedManager(
  pool: Pool,
  input: ReturnType<typeof parseHostedManagerInput>,
  hash: (password: string) => Promise<string> = hashPassword,
) {
  const password = await hash(input.password);
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(20261002, 1)');
    const existing = await client.query('SELECT id FROM "user" LIMIT 1');
    if (existing.rows.length) {
      throw new HostedManagerBootstrapError('users-exist');
    }
    await client.query("SELECT set_config('paygo.actor_id', $1, true)", [
      input.actor,
    ]);
    await client.query(
      'INSERT INTO "user" (id, name, email, role, "emailVerified") VALUES ($1, $2, $3, $4, true)',
      [id, input.name, input.email, input.role],
    );
    await client.query(
      'INSERT INTO account (id, "userId", "accountId", "providerId", password) VALUES ($1, $2, $2, $3, $4)',
      [randomUUID(), id, 'credential', password],
    );
    await client.query(
      'INSERT INTO identity_audit (user_id, action, actor) VALUES ($1, $2, $3)',
      [id, 'staff.provisioned', input.actor],
    );
    await client.query('COMMIT');
    return id;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      throw new HostedManagerBootstrapError('database');
    }
    if (error instanceof HostedManagerBootstrapError) throw error;
    throw new HostedManagerBootstrapError('database');
  } finally {
    client.release();
  }
}
