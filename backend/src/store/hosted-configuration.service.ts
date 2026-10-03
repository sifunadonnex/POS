import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import {
  signConfigurationBatch,
  type ConfigurationBatch,
  type ConfigurationEvent,
} from './configuration-batch.js';

type JournalRow = Omit<ConfigurationEvent, 'version'> & { version: string };

@Injectable()
export class HostedConfigurationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'connectionPool'>,
  ) {}

  async publishChanges(
    actor: { userId: string; sessionId: string },
    value: unknown,
  ): Promise<ConfigurationBatch> {
    const storeId = this.config.sync?.storeId;
    const secret = this.config.bootstrap?.secret;
    if (this.config.runtime.mode !== 'hosted' || !storeId || !secret) {
      throw new ServiceUnavailableException(
        'Hosted configuration is not configured',
      );
    }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new BadRequestException('Provide an edge configuration cursor');
    }
    const input = value as Record<string, unknown>;
    if (
      typeof input.afterVersion !== 'number' ||
      !Number.isSafeInteger(input.afterVersion) ||
      input.afterVersion < 1 ||
      typeof input.afterDigest !== 'string' ||
      !/^[0-9a-f]{64}$/.test(input.afterDigest)
    ) {
      throw new BadRequestException('Invalid edge configuration cursor');
    }
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const manager = await client.query(
        `SELECT u.id FROM "user" u JOIN session s ON s."userId" = u.id
        WHERE u.id = $1 AND s.id = $2 AND u.role = 'manager' AND NOT u.disabled
          AND u."emailVerified" AND u."twoFactorEnabled" AND s."mfaVerified"
          AND s."expiresAt" > now() AND s."lastActivityAt" > now() - interval '15 minutes'
          FOR SHARE OF u, s`,
        [actor.userId, actor.sessionId],
      );
      if (!manager.rowCount)
        throw new ForbiddenException('Manager MFA is required');
      const state = await client.query<{
        store_id: string;
        generation: number;
        configuration_version: string;
        configuration_digest: string | null;
        runtime_mode: string;
      }>('SELECT * FROM store_bootstrap_state WHERE singleton FOR SHARE');
      const checkpoint = state.rows[0];
      if (
        !checkpoint ||
        checkpoint.store_id !== storeId ||
        checkpoint.runtime_mode !== 'hosted' ||
        !checkpoint.configuration_digest
      )
        throw new ConflictException('Hosted snapshot is not published');
      const latest = Number(checkpoint.configuration_version);
      if (!Number.isSafeInteger(latest) || input.afterVersion > latest) {
        throw new ConflictException('Edge cursor is ahead of hosting');
      }
      const result = await client.query<JournalRow>(
        `SELECT version::text, transaction_id::text AS "transactionId",
        previous_digest AS "previousDigest", digest, entity, operation,
        entity_id AS "entityId", payload, actor_id AS "actorId", reason
        FROM store_configuration_journal WHERE store_id = $1 AND version > $2
        ORDER BY version LIMIT 2001`,
        [storeId, input.afterVersion],
      );
      let rows = result.rows;
      if (rows.length > 2000) {
        const lastTransaction = rows[1999].transactionId;
        let cut = 2000;
        while (cut > 0 && rows[cut - 1].transactionId === lastTransaction)
          cut--;
        if (cut === 0)
          throw new ConflictException(
            'One configuration transaction exceeds the batch limit',
          );
        rows = rows.slice(0, cut);
      }
      if (
        rows.length &&
        (Number(rows[0].version) !== input.afterVersion + 1 ||
          rows[0].previousDigest !== input.afterDigest)
      ) {
        throw new ConflictException(
          'Edge cursor does not match the hosted journal',
        );
      }
      if (
        !rows.length &&
        (input.afterVersion !== latest ||
          input.afterDigest !== checkpoint.configuration_digest)
      ) {
        throw new ConflictException('Edge cursor does not match hosting');
      }
      const issuedAt = new Date();
      let bundle: ConfigurationBatch;
      let bundleSize: number;
      do {
        const events = rows.map((row): ConfigurationEvent => ({
          ...row,
          version: Number(row.version),
        }));
        const last = events.at(-1);
        bundle = signConfigurationBatch(
          {
            schemaVersion: 1,
            storeId,
            generation: checkpoint.generation,
            fromVersion: input.afterVersion,
            fromDigest: input.afterDigest,
            toVersion: last?.version ?? input.afterVersion,
            toDigest: last?.digest ?? input.afterDigest,
            issuedAt: issuedAt.toISOString(),
            expiresAt: new Date(issuedAt.getTime() + 15 * 60_000).toISOString(),
            events,
          },
          secret,
        );
        bundleSize = Buffer.byteLength(JSON.stringify(bundle));
        if (bundleSize > 4_000_000) {
          const lastTransaction = rows.at(-1)?.transactionId;
          rows = rows.slice(
            0,
            rows.findIndex((row) => row.transactionId === lastTransaction),
          );
          if (!rows.length)
            throw new ConflictException(
              'One configuration transaction exceeds the byte limit',
            );
        }
      } while (bundleSize > 4_000_000);
      await client.query('COMMIT');
      return bundle;
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException('Configuration publication failed');
    } finally {
      client.release();
    }
  }
}
