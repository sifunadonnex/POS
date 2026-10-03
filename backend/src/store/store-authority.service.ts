import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';

type StoreStateRow = {
  store_id: string;
  runtime_mode: 'hosted' | 'edge';
  checkout_authority: 'hosted' | 'local';
  generation: number;
  configuration_version: string;
  configuration_digest: string | null;
  cutover_request_id: string | null;
  last_fence_request_id: string | null;
  opening_stock_at: Date | null;
  cutover_at: Date | null;
  roster_fresh: boolean;
};

function uuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

@Injectable()
export class StoreAuthorityService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'connectionPool'>,
  ) {}

  async assertWriteAllowed(scope: 'central' | 'operational'): Promise<void> {
    if (scope === 'central') {
      if (this.config.runtime.mode === 'edge') {
        throw new ForbiddenException(
          'Staff and catalogue changes must be made on the hosted service',
        );
      }
    }
    try {
      const result = await this.database.connectionPool.query<StoreStateRow>(
        `SELECT runtime_mode, checkout_authority, opening_stock_at, cutover_at,
          (last_roster_check_at IS NOT NULL AND last_roster_check_at <= now()
            AND last_roster_check_at > now() - interval '24 hours') AS roster_fresh
          FROM store_bootstrap_state WHERE singleton`,
      );
      if (
        result.rows[0] &&
        result.rows[0].runtime_mode !== this.config.runtime.mode
      ) {
        throw new ConflictException(
          'Store runtime does not match its database',
        );
      }
      if (
        scope === 'operational' &&
        this.config.runtime.mode === 'hosted' &&
        result.rows[0]?.checkout_authority === 'local'
      ) {
        throw new ConflictException(
          'Checkout and stock changes now belong to the local register',
        );
      }
      if (
        scope === 'operational' &&
        this.config.runtime.mode === 'edge' &&
        result.rows[0] &&
        (!result.rows[0].opening_stock_at ||
          !result.rows[0].cutover_at ||
          !result.rows[0].roster_fresh)
      ) {
        throw new ConflictException(
          'Local checkout requires opening stock, hosted cutover and a fresh roster',
        );
      }
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw new ServiceUnavailableException(
        'Store authority could not be verified',
      );
    }
  }

  async initialize(storeId: string): Promise<void> {
    if (!uuid(storeId)) throw new ConflictException('Invalid store identity');
    if (
      this.config.runtime.mode === 'edge' &&
      this.config.runtime.storeId !== storeId
    ) {
      throw new ConflictException('Edge store identity does not match');
    }
    if (this.config.sync && this.config.sync.storeId !== storeId) {
      throw new ConflictException(
        'Configured sync store identity does not match',
      );
    }
    const mode = this.config.runtime.mode;
    const authority = mode === 'edge' ? 'local' : 'hosted';
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO store_bootstrap_state
          (singleton, store_id, runtime_mode, checkout_authority)
        VALUES (true, $1, $2, $3) ON CONFLICT (singleton) DO NOTHING`,
        [storeId, mode, authority],
      );
      const state = await this.lockState(client);
      if (state.store_id !== storeId || state.runtime_mode !== mode) {
        throw new ConflictException('A different store is already registered');
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async advanceConfiguration(
    storeId: string,
    generation: number,
    expectedVersion: number,
    nextVersion: number,
    digest: string,
    apply?: (client: PoolClient) => Promise<void>,
  ): Promise<'applied' | 'duplicate'> {
    if (
      !uuid(storeId) ||
      !Number.isSafeInteger(generation) ||
      generation < 1 ||
      !Number.isSafeInteger(expectedVersion) ||
      expectedVersion < 0 ||
      !Number.isSafeInteger(nextVersion) ||
      !/^[0-9a-f]{64}$/.test(digest)
    ) {
      throw new ConflictException('Invalid configuration checkpoint');
    }
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN');
      const state = await this.lockState(client);
      this.requireStore(state, storeId, generation);
      const current = Number(state.configuration_version);
      if (!Number.isSafeInteger(current)) {
        throw new ConflictException('Configuration version is too large');
      }
      if (
        nextVersion === current &&
        expectedVersion === current - 1 &&
        state.configuration_digest === digest
      ) {
        await client.query('COMMIT');
        return 'duplicate';
      }
      if (expectedVersion !== current || nextVersion !== current + 1) {
        throw new ConflictException('Configuration checkpoint is out of order');
      }
      await client.query(
        `UPDATE store_bootstrap_state
        SET configuration_version = $1, configuration_digest = $2,
          updated_at = now() WHERE singleton`,
        [nextVersion, digest],
      );
      if (apply) await apply(client);
      await client.query('COMMIT');
      return 'applied';
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async cutOver(
    storeId: string,
    requestId: string,
  ): Promise<'applied' | 'duplicate'> {
    if (
      !uuid(storeId) ||
      !uuid(requestId) ||
      this.config.runtime.mode !== 'hosted'
    ) {
      throw new ConflictException('Invalid hosted cutover request');
    }
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN');
      const state = await this.lockState(client);
      if (state.store_id !== storeId || state.runtime_mode !== 'hosted') {
        throw new ConflictException('Store identity does not match');
      }
      if (state.checkout_authority === 'local') {
        if (state.cutover_request_id !== requestId) {
          throw new ConflictException('Store was already cut over');
        }
        await client.query('COMMIT');
        return 'duplicate';
      }
      if (
        Number(state.configuration_version) < 1 ||
        !state.configuration_digest
      ) {
        throw new ConflictException(
          'A configuration checkpoint is required before cutover',
        );
      }
      const open = await client.query(
        `SELECT 1 WHERE EXISTS (SELECT 1 FROM cash_shift WHERE status = 'open')
          OR EXISTS (SELECT 1 FROM payment_attempt WHERE status IN ('pending', 'unknown'))`,
      );
      if (open.rowCount) {
        throw new ConflictException(
          'Close shifts and resolve payment attempts before cutover',
        );
      }
      await client.query(
        `UPDATE store_bootstrap_state
        SET checkout_authority = 'local', cutover_request_id = $1,
          cutover_at = now(), updated_at = now() WHERE singleton`,
        [requestId],
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

  async fenceGeneration(
    storeId: string,
    expectedGeneration: number,
    requestId: string,
  ): Promise<{ generation: number; status: 'applied' | 'duplicate' }> {
    if (
      !uuid(storeId) ||
      !uuid(requestId) ||
      !Number.isSafeInteger(expectedGeneration) ||
      expectedGeneration < 1
    ) {
      throw new ConflictException('Invalid generation fence');
    }
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN');
      const state = await this.lockState(client);
      if (
        state.store_id !== storeId ||
        state.runtime_mode !== this.config.runtime.mode
      ) {
        throw new ConflictException('Store identity does not match');
      }
      if (
        state.generation === expectedGeneration + 1 &&
        state.last_fence_request_id === requestId
      ) {
        await client.query('COMMIT');
        return { generation: state.generation, status: 'duplicate' };
      }
      if (state.generation !== expectedGeneration) {
        throw new ConflictException('Stale store generation');
      }
      if (
        state.runtime_mode === 'hosted' &&
        state.checkout_authority !== 'local'
      ) {
        throw new ConflictException('Cut over the store before fencing a PC');
      }
      const generation = expectedGeneration + 1;
      await client.query(
        `UPDATE store_bootstrap_state
        SET generation = $1, last_fence_request_id = $2,
          updated_at = now() WHERE singleton`,
        [generation, requestId],
      );
      await client.query('COMMIT');
      return { generation, status: 'applied' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async lockState(client: PoolClient): Promise<StoreStateRow> {
    const result = await client.query<StoreStateRow>(
      'SELECT * FROM store_bootstrap_state WHERE singleton FOR UPDATE',
    );
    if (!result.rows[0]) {
      throw new ConflictException('Store has not been registered');
    }
    return result.rows[0];
  }

  private requireStore(
    state: StoreStateRow,
    storeId: string,
    generation: number,
  ): void {
    if (
      state.store_id !== storeId ||
      state.runtime_mode !== this.config.runtime.mode
    ) {
      throw new ConflictException('Store identity does not match');
    }
    if (state.generation !== generation) {
      throw new ConflictException('Stale store generation');
    }
  }
}
