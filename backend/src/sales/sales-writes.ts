import { createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';

export type SaleActor = { userId: string; sessionId: string };
type RequestTable = 'sale_request' | 'sale_payment_request';

@Injectable()
export class SalesWrites {
  private readonly logger = new Logger('SalesWrites');

  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async execute<T>(
    actor: SaleActor,
    requestId: string,
    payload: unknown,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.executeForRequestTable(
      'sale_request',
      actor,
      requestId,
      payload,
      work,
    );
  }

  async executePayment<T>(
    actor: SaleActor,
    requestId: string,
    payload: unknown,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    return this.executeForRequestTable(
      'sale_payment_request',
      actor,
      requestId,
      payload,
      work,
    );
  }

  private async executeForRequestTable<T>(
    requestTable: RequestTable,
    actor: SaleActor,
    requestId: string,
    payload: unknown,
    work: (client: PoolClient) => Promise<T>,
  ): Promise<T> {
    const operation =
      requestTable === 'sale_payment_request' ? 'payment' : 'sale';
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    let client: PoolClient | undefined;
    try {
      client = await this.database.connectionPool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 20260919))',
        [requestId],
      );

      const allowed = await client.query(
        `SELECT u.id FROM "user" u JOIN session s ON s."userId" = u.id
        WHERE u.id = $1 AND s.id = $2 AND u.role IN ('cashier', 'manager') AND NOT u.disabled
        AND u."emailVerified" AND u."twoFactorEnabled" AND s."mfaVerified"
        AND s."expiresAt" > now() AND s."lastActivityAt" > now() - interval '15 minutes' FOR SHARE OF u, s`,
        [actor.userId, actor.sessionId],
      );
      if (!allowed.rowCount) {
        throw new ForbiddenException('Verify cashier access again');
      }

      const previous = await client.query<{
        actor_id: string;
        fingerprint: string;
        response: unknown;
      }>(
        `SELECT actor_id, fingerprint, response FROM ${requestTable} WHERE id = $1`,
        [requestId],
      );
      const receipt = previous.rows[0];
      if (receipt) {
        if (
          receipt.actor_id !== actor.userId ||
          receipt.fingerprint !== fingerprint
        ) {
          throw new ConflictException(
            `This request ID was already used for a different ${operation}`,
          );
        }
        await client.query('COMMIT');
        return receipt.response as T;
      }

      const response = await work(client);
      await client.query(
        `INSERT INTO ${requestTable} (id, actor_id, fingerprint, response) VALUES ($1, $2, $3, $4)`,
        [requestId, actor.userId, fingerprint, JSON.stringify(response)],
      );
      await client.query('COMMIT');
      return response;
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          this.logger.error('Sale transaction rollback failed');
        }
      }
      if (error instanceof HttpException) throw error;
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '23505') {
          throw new ConflictException(
            `This ${operation} request is already committed. Reload and retry.`,
          );
        }
      }
      this.logger.error(
        error instanceof Error
          ? `Sale transaction failed: ${error.message}`
          : 'Sale transaction failed with an unknown error',
      );
      throw new ServiceUnavailableException(
        'The checkout could not be confirmed. Retry the same request to check its outcome.',
      );
    } finally {
      client?.release();
    }
  }
}
