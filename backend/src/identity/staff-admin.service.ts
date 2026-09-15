import { randomBytes, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { hashPassword } from 'better-auth/crypto';
import { fromNodeHeaders } from 'better-auth/node';
import { DatabaseService } from '../database/database.service.js';
import { AUTH, type PayGoAuth } from './auth.js';
import { AUTH_CONFIG, type AuthConfig } from './auth.config.js';
import type { StaffRequest } from './staff.guard.js';
import {
  confirmInput,
  emailInput,
  objectInput,
  staffId,
  staffInput,
  textInput,
} from './staff-admin.input.js';

type StaffRow = {
  id: string;
  name: string;
  email: string;
  role: 'manager' | 'cashier';
  disabled: boolean;
  emailVerified: boolean;
  twoFactorEnabled: boolean;
  revision: number;
};
const columns =
  'id, name, email, role, disabled, "emailVerified", "twoFactorEnabled", revision';

@Injectable()
export class StaffAdminService {
  private readonly logger = new Logger('StaffAdministration');
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(AUTH) private readonly auth: PayGoAuth,
    @Inject(AUTH_CONFIG) private readonly config: AuthConfig,
  ) {}

  async list(search: unknown, page: unknown) {
    const query =
      search === undefined || search === ''
        ? ''
        : textInput(search, 'search', 100);
    const pageNumber = page === undefined ? 0 : Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 0 || pageNumber > 200)
      throw new BadRequestException('Invalid page');
    try {
      const result = await this.database.connectionPool.query<StaffRow>(
        `SELECT ${columns} FROM "user" WHERE strpos(lower(name || ' ' || email), lower($1)) > 0 ORDER BY lower(name), id LIMIT 51 OFFSET $2`,
        [query, pageNumber * 50],
      );
      return {
        staff: result.rows.slice(0, 50),
        hasMore: result.rows.length > 50,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Staff records are temporarily unavailable',
      );
    }
  }

  private async transaction<T>(
    req: StaffRequest,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    let client: PoolClient | undefined;
    try {
      client = await this.database.connectionPool.connect();
      await client.query('BEGIN');
      // One administration lock keeps concurrent demotions/suspensions from removing the last manager.
      await client.query('SELECT pg_advisory_xact_lock(20260915, 2)');
      const actor = await client.query(
        'SELECT u.id FROM "user" u JOIN session s ON s."userId" = u.id WHERE u.id = $1 AND s.id = $2 AND u.role = $3 AND NOT u.disabled AND u."emailVerified" AND u."twoFactorEnabled" AND s."mfaVerified" AND s."expiresAt" > now() AND s."lastActivityAt" > now() - interval \'15 minutes\' FOR SHARE OF u, s',
        [req.staff.user.id, req.staff.session.id, 'manager'],
      );
      if (!actor.rowCount)
        throw new ForbiddenException('Manager access must be verified again');
      await client.query("SELECT set_config('paygo.actor_id', $1, true)", [
        req.staff.user.id,
      ]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          this.logger.error('Staff transaction rollback failed');
        }
      }
      if (error instanceof HttpException) throw error;
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === '23505'
      )
        throw new ConflictException(
          'An account with that email already exists',
        );
      throw new ServiceUnavailableException(
        'Staff change could not be confirmed. Reload before retrying',
      );
    } finally {
      client?.release();
    }
  }

  private async confirm(req: StaffRequest, password: string): Promise<void> {
    // The HTTP router does not rate-limit server-to-server auth.api calls.
    try {
      const rate = await this.database.connectionPool.query<{ count: number }>(
        `INSERT INTO "rateLimit" (id, key, count, "lastRequest") VALUES ($1, $2, 1, $3)
        ON CONFLICT (key) DO UPDATE SET count = CASE WHEN "rateLimit"."lastRequest" < $3 - 60000 THEN 1 ELSE "rateLimit".count + 1 END,
        "lastRequest" = CASE WHEN "rateLimit"."lastRequest" < $3 - 60000 THEN $3 ELSE "rateLimit"."lastRequest" END RETURNING count`,
        [randomUUID(), `staff-admin:${req.staff.user.id}`, Date.now()],
      );
      if (!rate.rows[0] || rate.rows[0].count > 5)
        throw new HttpException(
          'Too many attempts. Wait a minute before retrying',
          HttpStatus.TOO_MANY_REQUESTS,
        );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Staff verification is temporarily unavailable',
      );
    }
    try {
      await this.auth.api.verifyPassword({
        body: { password },
        headers: fromNodeHeaders(req.headers),
      });
    } catch {
      throw new ForbiddenException('Your password could not be confirmed');
    }
  }

  private async audit(
    client: PoolClient,
    actor: string,
    subject: string,
    action: string,
    reason: string,
  ) {
    await client.query(
      'INSERT INTO auth_audit (actor_id, subject_id, action, outcome, detail) VALUES ($1, $2, $3, $4, $5)',
      [actor, subject, action, 'success', JSON.stringify({ reason })],
    );
  }

  async create(req: StaffRequest, value: unknown) {
    const input = staffInput(value);
    const email = emailInput(objectInput(value).email);
    await this.confirm(req, input.password);
    // Initial password is random and never returned. Staff choose their own password through recovery email.
    const hashed = await hashPassword(randomBytes(32).toString('base64url'));
    return this.transaction(req, async (client) => {
      const id = randomUUID();
      const result = await client.query<StaffRow>(
        `INSERT INTO "user" (id, name, email, role) VALUES ($1, $2, $3, $4) RETURNING ${columns}`,
        [id, input.name, email, input.role],
      );
      await client.query(
        'INSERT INTO account (id, "userId", "accountId", "providerId", password) VALUES ($1, $2, $2, $3, $4)',
        [randomUUID(), id, 'credential', hashed],
      );
      await this.audit(
        client,
        req.staff.user.id,
        id,
        'staff.provisioned',
        input.reason,
      );
      return { staff: result.rows[0] };
    });
  }

  async update(req: StaffRequest, idValue: string, value: unknown) {
    const id = staffId(idValue);
    const input = staffInput(value, true);
    const body = objectInput(value);
    if (
      typeof body.disabled !== 'boolean' ||
      typeof body.revision !== 'number' ||
      !Number.isSafeInteger(body.revision) ||
      body.revision < 1
    )
      throw new BadRequestException('Provide account status and revision');
    const { disabled, revision } = body;
    if (id === req.staff.user.id && (disabled || input.role !== 'manager'))
      throw new ConflictException(
        'You cannot suspend or demote your own account',
      );
    await this.confirm(req, input.password);
    return this.transaction(req, async (client) => {
      const previous = await client.query<StaffRow>(
        `SELECT ${columns} FROM "user" WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const existing = previous.rows[0];
      if (!existing) throw new NotFoundException('Staff account not found');
      if (existing.revision !== revision)
        throw new ConflictException(
          'This account changed. Reload before editing',
        );
      if (
        existing.role === 'manager' &&
        !existing.disabled &&
        (disabled || input.role !== 'manager')
      ) {
        const remaining = await client.query(
          'SELECT id FROM "user" WHERE role = $1 AND disabled = false AND id <> $2 LIMIT 1',
          ['manager', id],
        );
        if (!remaining.rowCount)
          throw new ConflictException('Keep at least one active manager');
      }
      const updated = await client.query<StaffRow>(
        `UPDATE "user" SET name = $1, role = $2, disabled = $3, "updatedAt" = now() WHERE id = $4 RETURNING ${columns}`,
        [input.name, input.role, disabled, id],
      );
      await this.audit(
        client,
        req.staff.user.id,
        id,
        'staff.updated',
        input.reason,
      );
      return { staff: updated.rows[0] };
    });
  }

  async action(
    req: StaffRequest,
    idValue: string,
    action: string,
    value: unknown,
  ) {
    const id = staffId(idValue);
    const input = confirmInput(value);
    if (
      ![
        'revoke-sessions',
        'reset-mfa',
        'send-reset',
        'send-verification',
      ].includes(action)
    )
      throw new BadRequestException('Unknown staff action');
    if (action === 'reset-mfa' && id === req.staff.user.id)
      throw new ConflictException(
        'Use your recovery codes or ask another manager to reset your MFA',
      );
    if (action.startsWith('send-') && !this.config.smtp)
      throw new ServiceUnavailableException(
        'Configure SMTP email delivery first',
      );
    await this.confirm(req, input.password);
    const target = await this.transaction(req, async (client) => {
      const result = await client.query<StaffRow>(
        `SELECT ${columns} FROM "user" WHERE id = $1 FOR UPDATE`,
        [id],
      );
      const staff = result.rows[0];
      if (!staff) throw new NotFoundException('Staff account not found');
      if (action === 'reset-mfa') {
        await client.query(
          'UPDATE "user" SET "twoFactorEnabled" = false, "updatedAt" = now() WHERE id = $1',
          [id],
        );
        await client.query('DELETE FROM "twoFactor" WHERE "userId" = $1', [id]);
      }
      if (action === 'reset-mfa' || action === 'revoke-sessions') {
        await client.query('DELETE FROM session WHERE "userId" = $1', [id]);
        await client.query('DELETE FROM verification WHERE value = $1', [id]);
        await this.audit(
          client,
          req.staff.user.id,
          id,
          `staff.${action}`,
          input.reason,
        );
      }
      return staff;
    });
    if (action.startsWith('send-')) {
      try {
        // Deliberately omit the manager's cookie: the email belongs to the selected staff member.
        const headers = new Headers({ origin: this.config.baseURL });
        if (action === 'send-reset')
          await this.auth.api.requestPasswordReset({
            body: { email: target.email },
            headers,
          });
        else
          await this.auth.api.sendVerificationEmail({
            body: { email: target.email },
            headers,
          });
        await this.transaction(req, (client) =>
          this.audit(
            client,
            req.staff.user.id,
            id,
            `staff.${action}`,
            input.reason,
          ),
        );
      } catch {
        throw new ServiceUnavailableException(
          'Email delivery could not be confirmed. Check configuration before retrying',
        );
      }
    }
    return { status: true };
  }

  async auditLog(before: unknown) {
    if (
      before !== undefined &&
      (typeof before !== 'string' ||
        !/^[1-9]\d{0,18}$/.test(before) ||
        BigInt(before) > 9223372036854775807n)
    )
      throw new BadRequestException('Invalid audit cursor');
    try {
      const result = await this.database.connectionPool.query<{
        id: string;
        actorId: string | null;
        subjectId: string | null;
        action: string;
        outcome: string;
        detail: Record<string, unknown>;
        createdAt: Date;
      }>(
        'SELECT id::text, actor_id AS "actorId", subject_id AS "subjectId", action, outcome, detail, created_at AS "createdAt" FROM auth_audit WHERE ($1::bigint IS NULL OR id < $1) ORDER BY id DESC LIMIT 51',
        [before ?? null],
      );
      return {
        events: result.rows.slice(0, 50),
        next: result.rows.length > 50 ? result.rows[49].id : null,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Security history is temporarily unavailable',
      );
    }
  }
}
