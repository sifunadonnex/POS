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

export type CatalogueActor = { userId: string; sessionId: string };
export type CatalogueCommand = { requestId: string; reason: string };

@Injectable()
export class CatalogueWrites {
  private readonly logger = new Logger('CatalogueWrites');
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async execute(
    actor: CatalogueActor,
    command: CatalogueCommand,
    payload: unknown,
    work: (client: PoolClient) => Promise<Record<string, unknown>>,
  ): Promise<unknown> {
    const fingerprint = createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');
    let client: PoolClient | undefined;
    try {
      client = await this.database.connectionPool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 20260916))',
        [command.requestId],
      );
      const allowed = await client.query(
        `SELECT u.id FROM "user" u JOIN session s ON s."userId" = u.id
        WHERE u.id = $1 AND s.id = $2 AND u.role = 'manager' AND NOT u.disabled
        AND u."emailVerified" AND u."twoFactorEnabled" AND s."mfaVerified"
        AND s."expiresAt" > now() AND s."lastActivityAt" > now() - interval '15 minutes' FOR SHARE OF u, s`,
        [actor.userId, actor.sessionId],
      );
      if (!allowed.rowCount)
        throw new ForbiddenException('Verify manager access again');
      const previous = await client.query<{
        actor_id: string;
        fingerprint: string;
        response: unknown;
      }>(
        'SELECT actor_id, fingerprint, response FROM catalogue_request WHERE id = $1',
        [command.requestId],
      );
      const receipt = previous.rows[0];
      if (receipt) {
        if (
          receipt.actor_id !== actor.userId ||
          receipt.fingerprint !== fingerprint
        )
          throw new ConflictException(
            'This request ID was already used for a different change',
          );
        await client.query('COMMIT');
        return receipt.response;
      }
      const response = await work(client);
      await client.query(
        'INSERT INTO catalogue_request (id, actor_id, fingerprint, response) VALUES ($1, $2, $3, $4)',
        [
          command.requestId,
          actor.userId,
          fingerprint,
          JSON.stringify(response),
        ],
      );
      await client.query('COMMIT');
      return response;
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          this.logger.error('Catalogue transaction rollback failed');
        }
      }
      if (error instanceof HttpException) throw error;
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '23505')
          throw new ConflictException(
            'A SKU, barcode or category name is already in use. Reload and check the existing records.',
          );
        if (error.code === '23503')
          throw new ConflictException(
            'The selected category is unavailable. Reload and retry.',
          );
      }
      throw new ServiceUnavailableException(
        'The change could not be confirmed. Retry the same request to check its outcome.',
      );
    } finally {
      client?.release();
    }
  }
}
