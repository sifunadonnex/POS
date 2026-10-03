import { ConflictException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { AppConfig } from '../config/environment.js';
import { syncSecretDigest, verifyCutoverTicket } from './cutover-ticket.js';

export async function applyCutoverTicket(
  pool: Pool,
  config: AppConfig,
  value: unknown,
): Promise<'applied' | 'duplicate'> {
  if (
    process.env.PAYGO_CUTOVER_ENABLED !== 'true' ||
    config.runtime.mode !== 'edge' ||
    !config.runtime.storeId ||
    !config.bootstrap?.secret ||
    !config.sync?.secret
  ) {
    throw new ConflictException('Edge activation is disabled');
  }
  const ticket = verifyCutoverTicket(value, config.bootstrap.secret);
  if (
    ticket.storeId !== config.runtime.storeId ||
    ticket.syncSecretDigest !== syncSecretDigest(config.sync.secret)
  ) {
    throw new ConflictException(
      'Ticket store or synchronization secret does not match',
    );
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query<{
      generation: number;
      configuration_version: string;
      configuration_digest: string | null;
      cutover_request_id: string | null;
      cutover_at: Date | null;
      last_fence_request_id: string | null;
      opening_stock_at: Date | null;
      sync_secret_digest: string | null;
      roster_fresh: boolean;
    }>(
      `SELECT s.*,
      (s.last_roster_check_at IS NOT NULL AND s.last_roster_check_at <= now()
        AND s.last_roster_check_at > now() - interval '24 hours') AS roster_fresh
      FROM store_bootstrap_state s JOIN store_bootstrap_application a
        ON a.store_id = s.store_id AND a.opening_at IS NOT NULL
      WHERE s.singleton AND s.store_id = $1 AND s.runtime_mode = 'edge' FOR UPDATE OF s`,
      [ticket.storeId],
    );
    const state = result.rows[0];
    if (
      !state ||
      !state.opening_stock_at ||
      Number(state.configuration_version) !== ticket.configurationVersion ||
      state.configuration_digest !== ticket.configurationDigest
    ) {
      throw new ConflictException(
        'Edge opening count or configuration cursor does not match',
      );
    }
    const duplicate =
      ticket.kind === 'cutover'
        ? state.generation === ticket.toGeneration &&
          state.cutover_request_id === ticket.requestId &&
          state.sync_secret_digest === ticket.syncSecretDigest
        : state.generation === ticket.toGeneration &&
          state.last_fence_request_id === ticket.requestId &&
          state.sync_secret_digest === ticket.syncSecretDigest;
    if (duplicate) {
      await client.query('COMMIT');
      return 'duplicate';
    }
    if (
      state.generation !== ticket.fromGeneration ||
      (ticket.kind === 'cutover' &&
        (state.cutover_at || !state.roster_fresh)) ||
      (ticket.kind === 'fence' &&
        (!state.cutover_at ||
          state.sync_secret_digest === ticket.syncSecretDigest))
    ) {
      throw new ConflictException(
        'Edge generation or activation state does not match',
      );
    }
    const open = await client.query(`SELECT 1 WHERE EXISTS
      (SELECT 1 FROM cash_shift WHERE status = 'open') OR EXISTS
      (SELECT 1 FROM payment_attempt WHERE status IN ('pending','unknown'))`);
    if (open.rowCount)
      throw new ConflictException(
        'Close shifts and resolve payment attempts first',
      );
    if (ticket.kind === 'cutover') {
      await client.query(
        `UPDATE store_bootstrap_state SET cutover_request_id = $1,
        cutover_at = now(), sync_secret_digest = $2, updated_at = now()
        WHERE singleton`,
        [ticket.requestId, ticket.syncSecretDigest],
      );
    } else {
      await client.query(
        `UPDATE store_bootstrap_state SET generation = $1,
        last_fence_request_id = $2, sync_secret_digest = $3, updated_at = now()
        WHERE singleton`,
        [ticket.toGeneration, ticket.requestId, ticket.syncSecretDigest],
      );
      await client.query('DELETE FROM session');
    }
    await client.query(
      `INSERT INTO store_bootstrap_audit (store_id,action,actor_id,detail)
      VALUES ($1,$2,$3,$4)`,
      [
        ticket.storeId,
        ticket.kind === 'cutover'
          ? 'cutover.activated'
          : 'generation.activated',
        'hosted-cutover',
        JSON.stringify({
          requestId: ticket.requestId,
          fromGeneration: ticket.fromGeneration,
          toGeneration: ticket.toGeneration,
          configurationVersion: ticket.configurationVersion,
          signature: ticket.signature,
        }),
      ],
    );
    await client.query('COMMIT');
    return 'applied';
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
