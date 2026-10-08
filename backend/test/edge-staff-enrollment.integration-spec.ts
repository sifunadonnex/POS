import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { verifyPassword } from 'better-auth/crypto';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import {
  EdgeStaffEnrollmentService,
  redeemEdgeStaffGrant,
} from '../src/store/edge-staff-enrollment.service.js';

describe('edge staff enrollment on disposable PostgreSQL', () => {
  const schema = `edge_staff_${randomUUID().replaceAll('-', '')}`;
  const storeId = randomUUID();
  const managerId = randomUUID();
  const managerSession = randomUUID();
  const cashierId = randomUUID();
  const secondId = randomUUID();
  let pool: Pool;
  let config: ReturnType<typeof parseEnvironment>;
  let service: EdgeStaffEnrollmentService;
  const actor = { userId: managerId, sessionId: managerSession };
  const enrollment = (token: string, email = 'cashier@example.test') => ({
    token,
    email,
    password: 'Private-password-1234',
    attestIdentity: true,
    attestEmailControl: true,
    witnessedBy: 'Shift supervisor',
  });

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Explicit TEST_DATABASE_URL ending in _test is required');
    config = parseEnvironment({
      DATABASE_URL: url,
      DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
      NODE_ENV: 'test',
      PAYGO_RUNTIME_MODE: 'edge',
      PAYGO_STORE_ID: storeId,
    });
    pool = new Pool({
      ...databaseOptions(config),
      options: `-c search_path=${schema}`,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const client = await pool.connect();
    try {
      await runner({
        dbClient: client,
        dir: fileURLToPath(new URL('../migrations/', import.meta.url)),
        schema,
        migrationsSchema: schema,
        migrationsTable: 'pgmigrations',
        direction: 'up',
        singleTransaction: true,
        log: () => undefined,
      });
    } finally {
      client.release();
    }
    service = new EdgeStaffEnrollmentService(config, { connectionPool: pool });
    await pool.query(
      `INSERT INTO "user" (id,name,email,role,"emailVerified","twoFactorEnabled")
       VALUES ($1,'Manager','manager@example.test','manager',true,true),
              ($2,'Cashier','cashier@example.test','cashier',false,false),
              ($3,'Second','second@example.test','cashier',false,false)`,
      [managerId, cashierId, secondId],
    );
    await pool.query(
      `INSERT INTO session
       (id,"userId",token,"expiresAt","mfaVerified")
       VALUES ($1,$2,$3,now() + interval '1 hour',true)`,
      [managerSession, managerId, randomUUID()],
    );
    await pool.query(
      `INSERT INTO store_bootstrap_state
       (store_id,runtime_mode,checkout_authority,generation,
        configuration_version,configuration_digest,last_roster_check_at)
       VALUES ($1,'edge','local',1,1,$2,now())`,
      [storeId, 'a'.repeat(64)],
    );
    await pool.query(
      `INSERT INTO store_bootstrap_application
       (store_id,publication_id,digest,publisher_id,snapshot_payload,
        proposed_stock,manager_enrolled_at)
       VALUES ($1,$2,$3,$4,'{}','[]',now())`,
      [storeId, randomUUID(), 'a'.repeat(64), managerId],
    );
  });

  afterAll(async () => {
    if (pool) {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
      await pool.end();
    }
  });

  it('requires a current MFA manager and an eligible local roster entry', async () => {
    await expect(
      service.issueGrant(
        { userId: managerId, sessionId: randomUUID() },
        { staffId: cashierId },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.issueGrant(actor, { staffId: managerId }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.issueGrant(actor, { staffId: 'missing' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      service.issueGrant(actor, { staffId: cashierId, token: 'chosen' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (await pool.query('SELECT id FROM edge_staff_enrollment_grant')).rowCount,
    ).toBe(0);
  });

  it('stores only a token hash and atomically enrolls with a verifiable password and audits', async () => {
    const grant = await service.issueGrant(actor, { staffId: cashierId });
    expect(grant.staffId).toBe(cashierId);
    const stored = await pool.query<{ token_hash: string; generation: number }>(
      'SELECT token_hash,generation FROM edge_staff_enrollment_grant WHERE id = $1',
      [grant.grantId],
    );
    expect(stored.rows[0]).toEqual({
      token_hash: createHash('sha256').update(grant.token).digest('hex'),
      generation: 1,
    });
    await expect(
      service.issueGrant(actor, { staffId: cashierId }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      redeemEdgeStaffGrant(
        pool,
        config,
        enrollment(grant.token, 'wrong@example.test'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (
        await pool.query('SELECT id FROM account WHERE "userId" = $1', [
          cashierId,
        ])
      ).rowCount,
    ).toBe(0);
    await redeemEdgeStaffGrant(pool, config, enrollment(grant.token));
    const account = await pool.query<{ password: string }>(
      `SELECT password FROM account WHERE "userId" = $1 AND "providerId" = 'credential'`,
      [cashierId],
    );
    expect(account.rowCount).toBe(1);
    expect(
      await verifyPassword({
        hash: account.rows[0].password,
        password: enrollment(grant.token).password,
      }),
    ).toBe(true);
    expect(
      (
        await pool.query('SELECT "emailVerified" FROM "user" WHERE id = $1', [
          cashierId,
        ])
      ).rows[0].emailVerified,
    ).toBe(true);
    const audit = await pool.query<{
      action: string;
      detail: { grantId: string };
    }>('SELECT action,detail FROM store_bootstrap_audit ORDER BY id');
    expect(audit.rows.map((row) => row.action)).toEqual([
      'staff.enrollment-granted',
      'staff.enrolled',
    ]);
    expect(audit.rows[1].detail.grantId).toBe(grant.grantId);
    expect(JSON.stringify(audit.rows)).not.toContain(grant.token);
    expect(
      (
        await pool.query(
          "SELECT id FROM auth_audit WHERE action = 'staff.edge-enrolled'",
        )
      ).rowCount,
    ).toBe(1);
    await expect(
      redeemEdgeStaffGrant(pool, config, enrollment(grant.token)),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (
        await pool.query('SELECT id FROM account WHERE "userId" = $1', [
          cashierId,
        ])
      ).rowCount,
    ).toBe(1);
  });

  it('rejects missing attestation, expired grants and a suspended roster entry', async () => {
    const grant = await service.issueGrant(actor, { staffId: secondId });
    await expect(
      redeemEdgeStaffGrant(pool, config, {
        ...enrollment(grant.token, 'second@example.test'),
        attestIdentity: false,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await pool.query(
      `UPDATE edge_staff_enrollment_grant
       SET issued_at = now() - interval '2 minutes',
           expires_at = now() - interval '1 minute' WHERE id = $1`,
      [grant.grantId],
    );
    await expect(
      redeemEdgeStaffGrant(
        pool,
        config,
        enrollment(grant.token, 'second@example.test'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const replacement = await service.issueGrant(actor, { staffId: secondId });
    await pool.query('UPDATE "user" SET disabled = true WHERE id = $1', [
      secondId,
    ]);
    await expect(
      redeemEdgeStaffGrant(
        pool,
        config,
        enrollment(replacement.token, 'second@example.test'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(
      (
        await pool.query('SELECT id FROM account WHERE "userId" = $1', [
          secondId,
        ])
      ).rowCount,
    ).toBe(0);
    await pool.query(
      'UPDATE edge_staff_enrollment_grant SET revoked_at = now() WHERE id = $1',
      [replacement.grantId],
    );
  });

  it('fences old grants across a durable generation change and rejects a future roster clock', async () => {
    await pool.query('UPDATE "user" SET disabled = false WHERE id = $1', [
      secondId,
    ]);
    const grant = await service.issueGrant(actor, { staffId: secondId });
    await pool.query(
      'UPDATE store_bootstrap_state SET generation = 2, last_fence_request_id = $1 WHERE store_id = $2',
      [randomUUID(), storeId],
    );
    await expect(
      redeemEdgeStaffGrant(
        pool,
        config,
        enrollment(grant.token, 'second@example.test'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const replacement = await service.issueGrant(actor, { staffId: secondId });
    expect(replacement.grantId).not.toBe(grant.grantId);
    expect(
      (
        await pool.query<{ revoked_at: Date | null }>(
          'SELECT revoked_at FROM edge_staff_enrollment_grant WHERE id = $1',
          [grant.grantId],
        )
      ).rows[0].revoked_at,
    ).not.toBeNull();
    await pool.query(
      "UPDATE store_bootstrap_state SET last_roster_check_at = now() + interval '1 hour' WHERE store_id = $1",
      [storeId],
    );
    await expect(
      service.issueGrant(actor, { staffId: secondId }),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
