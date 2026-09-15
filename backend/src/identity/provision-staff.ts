import { randomUUID } from 'node:crypto';
import { hashPassword } from 'better-auth/crypto';
import type { Pool } from 'pg';

export function parseStaffInput(env: NodeJS.ProcessEnv) {
  const email = env.STAFF_EMAIL?.trim().toLowerCase() ?? '';
  const name = env.STAFF_NAME?.trim() ?? '';
  const password = env.STAFF_PASSWORD ?? '';
  const role = env.STAFF_ROLE;
  const actor = env.STAFF_PROVISIONED_BY?.trim() ?? '';
  if (
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
    email.length > 254 ||
    !name ||
    name.length > 100 ||
    password.length < 12 ||
    password.length > 128 ||
    (role !== 'manager' && role !== 'cashier') ||
    !actor ||
    actor.length > 100
  ) {
    throw new Error(
      'Provide valid STAFF_EMAIL, STAFF_NAME, STAFF_PASSWORD (12-128 characters), STAFF_ROLE (manager/cashier), and STAFF_PROVISIONED_BY',
    );
  }
  return { email, name, password, role, actor };
}

export async function provisionStaff(
  pool: Pool,
  input: ReturnType<typeof parseStaffInput>,
) {
  const password = await hashPassword(input.password);
  const id = randomUUID();
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      'INSERT INTO "user" (id, name, email, role) VALUES ($1, $2, $3, $4)',
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
  } catch {
    await client.query('ROLLBACK');
    throw new Error(
      'Staff creation failed; check migrations and whether the email already exists',
    );
  } finally {
    client.release();
  }
}
