import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import type { Pool, PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { emailInput, staffId } from '../identity/staff-admin.input.js';

type ManagerIdentity = { userId: string; sessionId: string };
type Enrollment = {
  token: string;
  email: string;
  password: string;
  attestIdentity: boolean;
  attestEmailControl: boolean;
  witnessedBy: string;
};

function edgeStore(config: AppConfig): string {
  if (config.runtime.mode !== 'edge' || !config.runtime.storeId)
    throw new ServiceUnavailableException(
      'Edge staff enrollment is unavailable',
    );
  return config.runtime.storeId;
}

async function lockFreshState(
  client: PoolClient,
  storeId: string,
): Promise<number> {
  const state = await client.query<{ generation: number }>(
    `SELECT generation FROM store_bootstrap_state
     WHERE store_id = $1 AND runtime_mode = 'edge'
       AND last_roster_check_at <= now()
       AND last_roster_check_at > now() - interval '24 hours'
     FOR UPDATE`,
    [storeId],
  );
  if (!state.rows[0])
    throw new ConflictException('A fresh edge roster is required');
  const application = await client.query(
    `SELECT 1 FROM store_bootstrap_application
     WHERE store_id = $1 AND manager_enrolled_at IS NOT NULL`,
    [storeId],
  );
  if (!application.rowCount)
    throw new ConflictException('Local manager enrollment is required');
  return state.rows[0].generation;
}

async function requireManager(
  client: PoolClient,
  actor: ManagerIdentity,
): Promise<void> {
  const result = await client.query(
    `SELECT u.id FROM "user" u JOIN session s ON s."userId" = u.id
     WHERE u.id = $1 AND s.id = $2 AND u.role = 'manager'
       AND NOT u.disabled AND u."emailVerified" AND u."twoFactorEnabled"
       AND s."mfaVerified" AND s."expiresAt" > now()
       AND s."lastActivityAt" > now() - interval '15 minutes'
     FOR SHARE OF u, s`,
    [actor.userId, actor.sessionId],
  );
  if (!result.rowCount)
    throw new ForbiddenException('Current manager MFA is required');
}

async function requireUnenrolledStaff(
  client: PoolClient,
  id: string,
  email?: string,
): Promise<void> {
  const result = await client.query(
    `SELECT u.id FROM "user" u WHERE u.id = $1
       AND u.role IN ('manager', 'cashier') AND NOT u.disabled
       AND NOT u."emailVerified" AND ($2::text IS NULL OR lower(u.email) = $2)
       AND NOT EXISTS (SELECT 1 FROM account a
                       WHERE a."userId" = u.id AND a."providerId" = 'credential')
     FOR UPDATE OF u`,
    [id, email ?? null],
  );
  if (!result.rowCount)
    throw new ForbiddenException('Staff is not eligible for local enrollment');
}

@Injectable()
export class EdgeStaffEnrollmentService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'connectionPool'>,
  ) {}

  async issueGrant(
    actor: ManagerIdentity,
    value: unknown,
  ): Promise<{
    grantId: string;
    staffId: string;
    token: string;
    expiresAt: string;
  }> {
    const storeId = edgeStore(this.config);
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('Staff ID is required');
    const body = value as Record<string, unknown>;
    if (Object.keys(body).some((key) => key !== 'staffId'))
      throw new BadRequestException('Unexpected enrollment field');
    const targetId = staffId(body.staffId);
    const token = randomBytes(32).toString('hex');
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const grantId = randomUUID();
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN');
      const generation = await lockFreshState(client, storeId);
      await requireManager(client, actor);
      await requireUnenrolledStaff(client, targetId);
      await client.query(
        `UPDATE edge_staff_enrollment_grant SET revoked_at = now()
         WHERE store_id = $1 AND staff_id = $2 AND consumed_at IS NULL
           AND revoked_at IS NULL
           AND (expires_at <= now() OR generation <> $3)`,
        [storeId, targetId, generation],
      );
      const inserted = await client.query<{ expires_at: Date }>(
        `INSERT INTO edge_staff_enrollment_grant
         (id, store_id, staff_id, manager_id, manager_session_id,
          generation, token_hash, expires_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,now() + interval '15 minutes')
         RETURNING expires_at`,
        [
          grantId,
          storeId,
          targetId,
          actor.userId,
          actor.sessionId,
          generation,
          tokenHash,
        ],
      );
      await client.query(
        `INSERT INTO store_bootstrap_audit (store_id, action, actor_id, detail)
         VALUES ($1,'staff.enrollment-granted',$2,$3)`,
        [
          storeId,
          actor.userId,
          JSON.stringify({ grantId, staffId: targetId, generation }),
        ],
      );
      await client.query('COMMIT');
      return {
        grantId,
        staffId: targetId,
        token,
        expiresAt: inserted.rows[0].expires_at.toISOString(),
      };
    } catch (error) {
      await client.query('ROLLBACK');
      if (error instanceof Error && 'code' in error && error.code === '23505') {
        throw new ConflictException('An enrollment grant is already open');
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

export async function redeemEdgeStaffGrant(
  pool: Pool,
  config: AppConfig,
  input: Enrollment,
  hash: (password: string) => Promise<string> = hashPassword,
): Promise<void> {
  const storeId = edgeStore(config);
  const email = emailInput(input.email);
  if (
    !/^[0-9a-f]{64}$/.test(input.token) ||
    !input.attestIdentity ||
    !input.attestEmailControl ||
    !input.witnessedBy?.trim() ||
    input.witnessedBy.length > 100 ||
    input.password.length < 12 ||
    input.password.length > 128
  ) {
    throw new BadRequestException(
      'Staff enrollment attestation or credential is invalid',
    );
  }
  const password = await hash(input.password);
  const tokenHash = createHash('sha256').update(input.token).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const generation = await lockFreshState(client, storeId);
    const grant = await client.query<{
      id: string;
      staff_id: string;
      manager_id: string;
      manager_session_id: string;
    }>(
      `SELECT id, staff_id, manager_id, manager_session_id
       FROM edge_staff_enrollment_grant
       WHERE store_id = $1 AND token_hash = $2 AND generation = $3
         AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at > now()
       FOR UPDATE`,
      [storeId, tokenHash, generation],
    );
    const row = grant.rows[0];
    if (!row)
      throw new ForbiddenException('Enrollment grant is invalid or expired');
    await requireManager(client, {
      userId: row.manager_id,
      sessionId: row.manager_session_id,
    });
    await requireUnenrolledStaff(client, row.staff_id, email);
    await client.query("SELECT set_config('paygo.actor_id', $1, true)", [
      row.manager_id,
    ]);
    await client.query(
      'UPDATE "user" SET "emailVerified" = true WHERE id = $1',
      [row.staff_id],
    );
    await client.query(
      `INSERT INTO account (id, "userId", "accountId", "providerId", password)
       VALUES ($1,$2,$2,'credential',$3)`,
      [randomUUID(), row.staff_id, password],
    );
    await client.query(
      `UPDATE edge_staff_enrollment_grant SET consumed_at = now() WHERE id = $1`,
      [row.id],
    );
    const detail = {
      grantId: row.id,
      staffId: row.staff_id,
      generation,
      witnessedBy: input.witnessedBy.trim(),
      identityAttested: true,
      emailControlAttested: true,
    };
    await client.query(
      `INSERT INTO store_bootstrap_audit (store_id, action, actor_id, detail)
       VALUES ($1,'staff.enrolled',$2,$3)`,
      [storeId, row.manager_id, JSON.stringify(detail)],
    );
    await client.query(
      `INSERT INTO auth_audit (actor_id, subject_id, action, outcome, detail)
       VALUES ($1,$2,'staff.edge-enrolled','success',$3)`,
      [row.manager_id, row.staff_id, JSON.stringify(detail)],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
