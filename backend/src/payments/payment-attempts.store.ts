import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import type {
  ExternalPaymentKind,
  PaymentAttemptStatus,
} from './payment-gateway.js';

export type PaymentActor = { userId: string; sessionId: string };

export type PaymentAttemptRecord = {
  id: string;
  request_id: string;
  actor_id: string;
  sale_id: string;
  shift_id: string;
  kind: ExternalPaymentKind;
  provider: string;
  provider_reference: string | null;
  amount_minor: string;
  status: PaymentAttemptStatus;
  request_fingerprint: string;
  reason: string;
  created_at: string | Date;
  updated_at: string | Date;
  confirmed_at: string | Date | null;
  payment_id: string | null;
};

export type PaymentAttemptResult = {
  attemptId: string;
  saleId: string;
  shiftId: string;
  kind: ExternalPaymentKind;
  provider: string;
  providerReference: string | null;
  amountMinor: number;
  status: PaymentAttemptStatus;
  paymentId: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
};

export type PreparedPaymentAttempt = {
  created: boolean;
  record: PaymentAttemptRecord;
};

export type PersistedGatewayResult = {
  status: PaymentAttemptStatus;
  providerReference?: string;
  providerEventId?: string;
  detailCode?: string;
};

function instant(value: string | Date): string {
  return new Date(value).toISOString();
}

@Injectable()
export class PaymentAttemptsStore {
  private readonly logger = new Logger('PaymentAttemptsStore');

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async prepare(
    actor: PaymentActor,
    requestId: string,
    fingerprint: string,
    payload: {
      saleId: string;
      kind: ExternalPaymentKind;
      reason: string;
    },
    provider: string,
  ): Promise<PreparedPaymentAttempt> {
    let client: PoolClient | undefined;
    try {
      client = await this.database.connectionPool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 20260923))',
        [requestId],
      );
      await this.requireActor(client, actor);

      const previous = await this.selectAttempt(
        client,
        'pa.request_id = $1',
        [requestId],
        true,
      );
      if (previous) {
        if (
          previous.actor_id !== actor.userId ||
          previous.request_fingerprint !== fingerprint
        ) {
          throw new ConflictException(
            'This request ID was already used for a different payment attempt',
          );
        }
        await client.query('COMMIT');
        return { created: false, record: previous };
      }

      const sale = await client.query<{
        total_minor: string;
        status: string;
      }>(
        'SELECT total_minor::text, status FROM sale WHERE id = $1 FOR UPDATE',
        [payload.saleId],
      );
      if (!sale.rowCount) throw new NotFoundException('Sale not found');
      if (sale.rows[0].status !== 'completed') {
        throw new ConflictException(
          'Only a finalized sale can start a payment attempt',
        );
      }

      const paid = await client.query<{ paid_minor: string }>(
        `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE status = 'paid'), 0)::text AS paid_minor
        FROM sale_payment WHERE sale_id = $1`,
        [payload.saleId],
      );
      const amountMinor =
        Number(sale.rows[0].total_minor) -
        Number(paid.rows[0]?.paid_minor ?? 0);
      if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0) {
        throw new ConflictException('The sale has no outstanding balance');
      }

      const active = await client.query(
        `SELECT id FROM payment_attempt
        WHERE sale_id = $1 AND status IN ('pending', 'unknown') LIMIT 1`,
        [payload.saleId],
      );
      if (active.rowCount) {
        throw new ConflictException(
          'This sale already has a payment attempt requiring confirmation',
        );
      }

      const shift = await client.query<{ id: string }>(
        `SELECT id FROM cash_shift
        WHERE cashier_id = $1 AND status = 'open'
        ORDER BY opened_at DESC LIMIT 1 FOR UPDATE`,
        [actor.userId],
      );
      if (!shift.rowCount) {
        throw new ConflictException(
          'Open a register shift before starting a payment attempt',
        );
      }

      const attemptId = randomUUID();
      await client.query(
        `INSERT INTO payment_attempt
        (id, request_id, actor_id, sale_id, shift_id, kind, provider, amount_minor, status, request_fingerprint, reason)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)`,
        [
          attemptId,
          requestId,
          actor.userId,
          payload.saleId,
          shift.rows[0].id,
          payload.kind,
          provider,
          amountMinor,
          fingerprint,
          payload.reason,
        ],
      );
      await client.query(
        `INSERT INTO payment_attempt_event
        (id, attempt_id, source, status, detail_code)
        VALUES ($1, $2, 'created', 'pending', 'attempt_created')`,
        [randomUUID(), attemptId],
      );
      const record = await this.selectAttempt(
        client,
        'pa.id = $1',
        [attemptId],
        true,
      );
      if (!record) throw new Error('Created payment attempt is unavailable');
      await client.query('COMMIT');
      return { created: true, record };
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          this.logger.error('Payment attempt rollback failed');
        }
      }
      return this.rethrowDatabaseError(error);
    } finally {
      client?.release();
    }
  }

  async apply(
    attemptId: string,
    source: 'initiation' | 'reconciliation' | 'callback',
    result: PersistedGatewayResult,
  ): Promise<PaymentAttemptResult> {
    let client: PoolClient | undefined;
    try {
      client = await this.database.connectionPool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      const attempt = await this.selectAttempt(
        client,
        'pa.id = $1',
        [attemptId],
        true,
      );
      if (!attempt) throw new NotFoundException('Payment attempt not found');
      if (attempt.status === 'confirmed' || attempt.status === 'failed') {
        await client.query('COMMIT');
        return this.toResult(attempt);
      }

      if (result.providerEventId) {
        const duplicate = await client.query(
          `SELECT id FROM payment_attempt_event
          WHERE attempt_id = $1 AND provider_event_id = $2`,
          [attemptId, result.providerEventId],
        );
        if (duplicate.rowCount) {
          await client.query('COMMIT');
          return this.toResult(attempt);
        }
      }

      await client.query(
        `INSERT INTO payment_attempt_event
        (id, attempt_id, source, status, provider_event_id, provider_reference, detail_code)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          randomUUID(),
          attemptId,
          source,
          result.status,
          result.providerEventId ?? null,
          result.providerReference ?? attempt.provider_reference,
          result.detailCode ?? null,
        ],
      );

      await client.query(
        `UPDATE payment_attempt SET status = $2,
        provider_reference = COALESCE(provider_reference, $3),
        updated_at = now(), confirmed_at = $4
        WHERE id = $1`,
        [
          attemptId,
          result.status,
          result.providerReference ?? null,
          result.status === 'confirmed' ? new Date() : null,
        ],
      );

      if (result.status === 'confirmed') {
        await this.recordConfirmedPayment(client, attempt);
      }

      const updated = await this.selectAttempt(
        client,
        'pa.id = $1',
        [attemptId],
        true,
      );
      if (!updated) throw new Error('Updated payment attempt is unavailable');
      await client.query('COMMIT');
      return this.toResult(updated);
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          this.logger.error('Payment result rollback failed');
        }
      }
      return this.rethrowDatabaseError(error);
    } finally {
      client?.release();
    }
  }

  async authorized(
    actor: PaymentActor,
    attemptId: string,
  ): Promise<PaymentAttemptRecord> {
    try {
      const result =
        await this.database.connectionPool.query<PaymentAttemptRecord>(
          `${this.attemptSelect()}
        WHERE pa.id = $1 AND EXISTS (
          SELECT 1 FROM "user" u JOIN session s ON s."userId" = u.id
          WHERE u.id = $2 AND s.id = $3 AND NOT u.disabled AND u."emailVerified"
          AND u.role IN ('cashier', 'manager')
          AND ((u.role = 'cashier' AND NOT u."twoFactorEnabled")
            OR (u."twoFactorEnabled" AND s."mfaVerified"))
          AND s."expiresAt" > now()
          AND s."lastActivityAt" > now() - interval '15 minutes'
          AND (u.role = 'manager' OR pa.actor_id = u.id)
        )`,
          [attemptId, actor.userId, actor.sessionId],
        );
      if (!result.rowCount)
        throw new NotFoundException('Payment attempt not found');
      return result.rows[0];
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'The payment attempt is temporarily unavailable',
      );
    }
  }

  toResult(row: PaymentAttemptRecord): PaymentAttemptResult {
    return {
      attemptId: row.id,
      saleId: row.sale_id,
      shiftId: row.shift_id,
      kind: row.kind,
      provider: row.provider,
      providerReference: row.provider_reference,
      amountMinor: Number(row.amount_minor),
      status: row.status,
      paymentId: row.payment_id,
      createdAt: instant(row.created_at),
      updatedAt: instant(row.updated_at),
      confirmedAt: row.confirmed_at ? instant(row.confirmed_at) : null,
    };
  }

  private async recordConfirmedPayment(
    client: PoolClient,
    attempt: PaymentAttemptRecord,
  ): Promise<void> {
    await client.query('SELECT id FROM sale WHERE id = $1 FOR UPDATE', [
      attempt.sale_id,
    ]);
    const paid = await client.query<{ paid_minor: string }>(
      `SELECT COALESCE(SUM(amount_minor) FILTER (WHERE status = 'paid'), 0)::text AS paid_minor
      FROM sale_payment WHERE sale_id = $1`,
      [attempt.sale_id],
    );
    const sale = await client.query<{ total_minor: string }>(
      'SELECT total_minor::text FROM sale WHERE id = $1',
      [attempt.sale_id],
    );
    if (
      Number(paid.rows[0]?.paid_minor ?? 0) + Number(attempt.amount_minor) >
      Number(sale.rows[0]?.total_minor ?? 0)
    ) {
      throw new ConflictException('Confirmed payment exceeds the sale total');
    }
    await client.query(
      `INSERT INTO sale_payment
      (id, sale_id, shift_id, payment_attempt_id, kind, amount_minor, status, reason, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, 'paid', $7, now())`,
      [
        randomUUID(),
        attempt.sale_id,
        attempt.shift_id,
        attempt.id,
        attempt.kind,
        Number(attempt.amount_minor),
        attempt.reason,
      ],
    );
  }

  private async requireActor(
    client: PoolClient,
    actor: PaymentActor,
  ): Promise<void> {
    const allowed = await client.query(
      `SELECT u.id FROM "user" u JOIN session s ON s."userId" = u.id
      WHERE u.id = $1 AND s.id = $2 AND u.role IN ('cashier', 'manager') AND NOT u.disabled
      AND u."emailVerified"
      AND ((u.role = 'cashier' AND NOT u."twoFactorEnabled")
        OR (u."twoFactorEnabled" AND s."mfaVerified"))
      AND s."expiresAt" > now() AND s."lastActivityAt" > now() - interval '15 minutes'
      FOR SHARE OF u, s`,
      [actor.userId, actor.sessionId],
    );
    if (!allowed.rowCount)
      throw new ForbiddenException('Verify cashier access again');
  }

  private async selectAttempt(
    client: PoolClient,
    predicate: string,
    params: unknown[],
    lock: boolean,
  ): Promise<PaymentAttemptRecord | undefined> {
    const result = await client.query<PaymentAttemptRecord>(
      `${this.attemptSelect()} WHERE ${predicate}${lock ? ' FOR UPDATE OF pa' : ''}`,
      params,
    );
    return result.rows[0];
  }

  private attemptSelect(): string {
    return `SELECT pa.id, pa.request_id, pa.actor_id, pa.sale_id, pa.shift_id,
      pa.kind, pa.provider, pa.provider_reference, pa.amount_minor::text,
      pa.status, pa.request_fingerprint, pa.reason, pa.created_at,
      pa.updated_at, pa.confirmed_at, sp.id AS payment_id
      FROM payment_attempt pa
      LEFT JOIN sale_payment sp ON sp.payment_attempt_id = pa.id`;
  }

  private rethrowDatabaseError(error: unknown): never {
    if (error instanceof HttpException) throw error;
    if (error && typeof error === 'object' && 'code' in error) {
      if (error.code === '23505') {
        throw new ConflictException(
          'This payment event is already recorded. Reload its current status.',
        );
      }
    }
    this.logger.error(
      error instanceof Error
        ? `Payment attempt failed: ${error.message}`
        : 'Payment attempt failed with an unknown error',
    );
    throw new ServiceUnavailableException(
      'The payment result could not be confirmed. Reconcile this attempt before retrying.',
    );
  }
}
