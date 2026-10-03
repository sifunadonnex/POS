import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { createSyncSignature } from './sync-auth.js';

export const SYNC_FETCH = Symbol('SYNC_FETCH');
export type SyncFetch = typeof globalThis.fetch;

type OutboxJob = {
  id: string;
  store_id: string;
  event_type: 'cash_sale.completed';
  aggregate_id: string;
  schema_version: 1 | 2;
  payload: Record<string, unknown>;
  attempt_count: number;
};

@Injectable()
export class EdgeSyncWorker
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(EdgeSyncWorker.name);
  private timer?: ReturnType<typeof setInterval>;
  private running: Promise<unknown> | null = null;
  private stopped = false;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(SYNC_FETCH) private readonly fetcher: SyncFetch,
  ) {}

  onApplicationBootstrap(): void {
    if (
      this.config.runtime.mode !== 'edge' ||
      !this.config.sync?.targetUrl ||
      process.env.NODE_ENV === 'test'
    ) {
      return;
    }
    const run = () => {
      if (this.stopped || this.running) return;
      this.running = this.deliverBatch()
        .catch(() => this.logger.error('Edge synchronization is unavailable'))
        .finally(() => {
          this.running = null;
        });
    };
    run();
    this.timer = setInterval(run, this.config.sync.pollSeconds * 1000);
    this.timer.unref();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  async deliverBatch(): Promise<number> {
    const sync = this.config.sync;
    if (
      this.config.runtime.mode !== 'edge' ||
      !sync?.targetUrl ||
      sync.storeId !== this.config.runtime.storeId
    ) {
      return 0;
    }
    const authority = await this.database.connectionPool.query<{
      generation: number;
      cutover_at: Date | null;
    }>(
      'SELECT generation, cutover_at FROM store_bootstrap_state WHERE singleton',
    );
    const state = authority.rows[0];
    if (state && !state.cutover_at) return 0;
    const generation = state?.generation;
    const claimed = await this.database.connectionPool.query<OutboxJob>(
      `WITH ready AS (
        SELECT id FROM sync_outbox
        WHERE delivered_at IS NULL AND next_attempt_at <= now()
        ORDER BY created_at, id LIMIT 5 FOR UPDATE SKIP LOCKED
      )
      UPDATE sync_outbox o
      SET attempt_count = attempt_count + 1,
        last_attempt_at = now(),
        next_attempt_at = now() + interval '5 minutes',
        last_error = NULL
      FROM ready WHERE o.id = ready.id
      RETURNING o.id, o.store_id::text, o.event_type, o.aggregate_id::text,
        o.schema_version, o.payload, o.attempt_count`,
    );
    for (const job of claimed.rows) {
      let delivered = false;
      try {
        const envelope = {
          eventId: job.id,
          storeId: job.store_id,
          eventType: job.event_type,
          aggregateId: job.aggregate_id,
          schemaVersion: job.schema_version,
          occurredAt: String(job.payload.occurredAt ?? ''),
          payload: job.payload,
        };
        const timestamp = String(Math.floor(Date.now() / 1000));
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          const response = await this.fetcher(sync.targetUrl, {
            method: 'POST',
            redirect: 'error',
            signal: controller.signal,
            headers: {
              'Content-Type': 'application/json',
              'X-PayGo-Store-Id': job.store_id,
              'X-PayGo-Event-Id': job.id,
              'X-PayGo-Timestamp': timestamp,
              ...(generation
                ? { 'X-PayGo-Generation': String(generation) }
                : {}),
              'X-PayGo-Signature': createSyncSignature(
                sync.secret,
                job.store_id,
                job.id,
                timestamp,
                envelope,
                generation,
              ),
            },
            body: JSON.stringify(envelope),
          });
          const acknowledgement: unknown = await response.json();
          if (
            !response.ok ||
            !acknowledgement ||
            typeof acknowledgement !== 'object' ||
            !('eventId' in acknowledgement) ||
            acknowledgement.eventId !== job.id ||
            !('status' in acknowledgement) ||
            (acknowledgement.status !== 'accepted' &&
              acknowledgement.status !== 'duplicate') ||
            (generation !== undefined &&
              (!('generation' in acknowledgement) ||
                acknowledgement.generation !== generation))
          ) {
            throw new Error('Invalid synchronization acknowledgement');
          }
          delivered = true;
        } finally {
          clearTimeout(timeout);
        }
      } catch {
        this.logger.error(
          'An edge event was not acknowledged; a bounded retry was scheduled',
        );
      }
      if (delivered) {
        await this.database.connectionPool.query(
          `UPDATE sync_outbox SET delivered_at = now(), next_attempt_at = now(), last_error = NULL
          WHERE id = $1 AND delivered_at IS NULL AND attempt_count = $2`,
          [job.id, job.attempt_count],
        );
      } else {
        const delaySeconds = Math.min(
          300,
          5 * 2 ** Math.min(job.attempt_count - 1, 6),
        );
        await this.database.connectionPool.query(
          `UPDATE sync_outbox SET next_attempt_at = now() + ($2 * interval '1 second'),
            last_error = 'Delivery was not acknowledged'
          WHERE id = $1 AND delivered_at IS NULL AND attempt_count = $3`,
          [job.id, delaySeconds, job.attempt_count],
        );
      }
    }
    return claimed.rows.length;
  }
}
