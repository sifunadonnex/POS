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
  signCutoverTicket,
  syncSecretDigest,
  type CutoverTicket,
} from './cutover-ticket.js';

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const digest = /^[0-9a-f]{64}$/;

@Injectable()
export class HostedCutoverService {
  private readonly enabled = process.env.PAYGO_CUTOVER_ENABLED === 'true';
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'connectionPool'>,
  ) {}

  async issue(
    actor: { userId: string; sessionId: string },
    kind: 'cutover' | 'fence',
    value: unknown,
  ): Promise<CutoverTicket> {
    const storeId = this.config.sync?.storeId;
    const syncSecret = this.config.sync?.secret;
    const ticketSecret = this.config.bootstrap?.secret;
    if (
      !this.enabled ||
      this.config.runtime.mode !== 'hosted' ||
      !storeId ||
      !syncSecret ||
      !ticketSecret
    ) {
      throw new ServiceUnavailableException('Cutover issuance is disabled');
    }
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('Invalid cutover request');
    const input = value as Record<string, unknown>;
    if (
      typeof input.requestId !== 'string' ||
      !uuid.test(input.requestId) ||
      typeof input.expectedGeneration !== 'number' ||
      !Number.isSafeInteger(input.expectedGeneration) ||
      input.expectedGeneration < 1 ||
      typeof input.configurationVersion !== 'number' ||
      !Number.isSafeInteger(input.configurationVersion) ||
      input.configurationVersion < 1 ||
      typeof input.configurationDigest !== 'string' ||
      !digest.test(input.configurationDigest)
    ) {
      throw new BadRequestException('Invalid cutover request');
    }
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN');
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
      const result = await client.query<{
        store_id: string;
        runtime_mode: string;
        checkout_authority: string;
        generation: number;
        configuration_version: string;
        configuration_digest: string | null;
        cutover_request_id: string | null;
        last_fence_request_id: string | null;
        sync_secret_digest: string | null;
      }>('SELECT * FROM store_bootstrap_state WHERE singleton FOR UPDATE');
      const state = result.rows[0];
      if (
        !state ||
        state.store_id !== storeId ||
        state.runtime_mode !== 'hosted' ||
        Number(state.configuration_version) !== input.configurationVersion ||
        state.configuration_digest !== input.configurationDigest
      ) {
        throw new ConflictException(
          'Hosted store or edge configuration cursor does not match',
        );
      }
      const secretHash = syncSecretDigest(syncSecret);
      const requestId = input.requestId;
      const expected = input.expectedGeneration;
      let toGeneration: number;
      let duplicate = false;
      if (kind === 'cutover') {
        if (state.generation !== expected)
          throw new ConflictException('Stale store generation');
        duplicate =
          state.checkout_authority === 'local' &&
          state.cutover_request_id === requestId;
        if (!duplicate && state.checkout_authority !== 'hosted')
          throw new ConflictException('Store was already cut over');
        if (duplicate && state.sync_secret_digest !== secretHash)
          throw new ConflictException('Synchronization secret changed');
        toGeneration = expected;
      } else {
        duplicate =
          state.generation === expected + 1 &&
          state.last_fence_request_id === requestId;
        if (
          !duplicate &&
          (state.generation !== expected ||
            state.checkout_authority !== 'local' ||
            !state.sync_secret_digest ||
            state.sync_secret_digest === secretHash)
        ) {
          throw new ConflictException(
            'Fencing requires cutover and a rotated synchronization secret',
          );
        }
        if (duplicate && state.sync_secret_digest !== secretHash)
          throw new ConflictException('Synchronization secret changed');
        toGeneration = expected + 1;
      }
      if (!duplicate) {
        const open = await client.query(`SELECT 1 WHERE EXISTS
          (SELECT 1 FROM cash_shift WHERE status = 'open') OR EXISTS
          (SELECT 1 FROM payment_attempt WHERE status IN ('pending','unknown'))`);
        if (open.rowCount)
          throw new ConflictException(
            'Close shifts and resolve payment attempts first',
          );
        if (kind === 'cutover') {
          await client.query(
            `UPDATE store_bootstrap_state SET checkout_authority = 'local',
            cutover_request_id = $1, cutover_at = now(), sync_secret_digest = $2,
            updated_at = now() WHERE singleton`,
            [requestId, secretHash],
          );
        } else {
          await client.query(
            `UPDATE store_bootstrap_state SET generation = $1,
            last_fence_request_id = $2, sync_secret_digest = $3,
            updated_at = now() WHERE singleton`,
            [toGeneration, requestId, secretHash],
          );
        }
      }
      const issuedAt = new Date();
      const ticket = signCutoverTicket(
        {
          schemaVersion: 1,
          kind,
          storeId,
          requestId,
          fromGeneration: expected,
          toGeneration,
          configurationVersion: input.configurationVersion,
          configurationDigest: input.configurationDigest,
          syncSecretDigest: secretHash,
          issuedAt: issuedAt.toISOString(),
          expiresAt: new Date(issuedAt.getTime() + 15 * 60_000).toISOString(),
        },
        ticketSecret,
      );
      await client.query(
        `INSERT INTO store_bootstrap_audit (store_id,action,actor_id,detail)
        VALUES ($1,$2,$3,$4)`,
        [
          storeId,
          kind === 'cutover' ? 'cutover.issued' : 'generation.fenced',
          actor.userId,
          JSON.stringify({
            requestId,
            fromGeneration: expected,
            toGeneration,
            configurationVersion: input.configurationVersion,
            duplicate,
            signature: ticket.signature,
          }),
        ],
      );
      await client.query('COMMIT');
      return ticket;
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        error instanceof BadRequestException ||
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException('Cutover issuance failed');
    } finally {
      client.release();
    }
  }
}
