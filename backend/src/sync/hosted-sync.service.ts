import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import {
  canonicalJson,
  createSyncSignature,
  signaturesMatch,
} from './sync-auth.js';
import { parseSyncEnvelope, type SyncEnvelope } from './sync-envelope.js';
import { projectCompletedCashSale } from './sync-projection.js';

export type SyncHeaders = {
  storeId?: string;
  eventId?: string;
  timestamp?: string;
  signature?: string;
};

@Injectable()
export class HostedSyncService {
  private readonly logger = new Logger(HostedSyncService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async ingest(headers: SyncHeaders, value: unknown, now = Date.now()) {
    const sync = this.config.sync;
    if (this.config.runtime.mode !== 'hosted' || !sync) {
      throw new NotFoundException(
        'Synchronization ingestion is not configured',
      );
    }
    const storeId = headers.storeId ?? '';
    const eventId = headers.eventId ?? '';
    const timestamp = headers.timestamp ?? '';
    const signature = headers.signature ?? '';
    const seconds = Number(timestamp);
    if (
      storeId !== sync.storeId ||
      !/^\d{10}$/.test(timestamp) ||
      !Number.isSafeInteger(seconds) ||
      Math.abs(Math.floor(now / 1000) - seconds) > 300
    ) {
      throw new UnauthorizedException('Invalid synchronization credentials');
    }
    let expected: string;
    try {
      expected = createSyncSignature(
        sync.secret,
        storeId,
        eventId,
        timestamp,
        value,
      );
    } catch {
      throw new UnauthorizedException('Invalid synchronization credentials');
    }
    if (!signaturesMatch(expected, signature)) {
      throw new UnauthorizedException('Invalid synchronization credentials');
    }
    const envelope = parseSyncEnvelope(value);
    if (envelope.storeId !== storeId || envelope.eventId !== eventId) {
      throw new UnauthorizedException('Invalid synchronization credentials');
    }
    const fingerprint = createHash('sha256')
      .update(canonicalJson(value))
      .digest('hex');
    return this.persist(envelope, fingerprint);
  }

  private async persist(envelope: SyncEnvelope, fingerprint: string) {
    let client: PoolClient | undefined;
    try {
      client = await this.database.connectionPool.connect();
      await client.query('BEGIN');
      await client.query("SET LOCAL statement_timeout = '10s'");
      const lockKeys = [
        `${envelope.storeId}:event:${envelope.eventId}`,
        `${envelope.storeId}:${envelope.eventType}:${envelope.aggregateId}`,
      ].sort();
      for (const key of lockKeys) {
        await client.query(
          'SELECT pg_advisory_xact_lock(hashtextextended($1, 20261002))',
          [key],
        );
      }
      const previous = await client.query<{
        id: string;
        payload_hash: string;
      }>(
        `SELECT id, payload_hash FROM sync_inbox
        WHERE id = $1 OR (store_id = $2 AND event_type = $3 AND aggregate_id = $4)
        FOR UPDATE`,
        [
          envelope.eventId,
          envelope.storeId,
          envelope.eventType,
          envelope.aggregateId,
        ],
      );
      if (previous.rows.length > 1) {
        throw new ConflictException(
          'This synchronization identity conflicts with existing data',
        );
      }
      const existing = previous.rows[0];
      let status: 'accepted' | 'duplicate' = 'accepted';
      if (existing) {
        if (
          existing.id !== envelope.eventId ||
          existing.payload_hash !== fingerprint
        ) {
          throw new ConflictException(
            'This synchronization identity was already used for different data',
          );
        }
        status = 'duplicate';
      } else {
        await client.query(
          `INSERT INTO sync_inbox
            (id, store_id, event_type, aggregate_id, schema_version, payload, payload_hash, occurred_at)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            envelope.eventId,
            envelope.storeId,
            envelope.eventType,
            envelope.aggregateId,
            envelope.schemaVersion,
            JSON.stringify(envelope.payload),
            fingerprint,
            envelope.occurredAt,
          ],
        );
      }
      await projectCompletedCashSale(client, envelope);
      const checkpoint = await client.query<{
        accepted_events: string;
        latest_received_at: string | null;
      }>(
        `SELECT count(*)::text AS accepted_events,
          max(received_at)::text AS latest_received_at
        FROM sync_inbox WHERE store_id = $1`,
        [envelope.storeId],
      );
      await client.query('COMMIT');
      return {
        eventId: envelope.eventId,
        status,
        checkpoint: {
          acceptedEvents: Number(checkpoint.rows[0]?.accepted_events ?? 0),
          latestReceivedAt: checkpoint.rows[0]?.latest_received_at ?? null,
        },
      };
    } catch (error) {
      if (client) {
        try {
          await client.query('ROLLBACK');
        } catch {
          this.logger.error('Synchronization inbox rollback failed');
        }
      }
      if (error instanceof HttpException) throw error;
      if (error && typeof error === 'object' && 'code' in error) {
        if (error.code === '23505') {
          throw new ConflictException(
            'This synchronization identity conflicts with existing data',
          );
        }
      }
      this.logger.error('Synchronization inbox persistence failed');
      throw new ServiceUnavailableException(
        'The synchronization event could not be confirmed. Retry the same event.',
      );
    } finally {
      client?.release();
    }
  }
}
