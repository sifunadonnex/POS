import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import {
  verifyConfigurationBatch,
  type ConfigurationEvent,
} from './configuration-batch.js';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function field(value: unknown, max = 254): string {
  if (typeof value !== 'string' || !value || value.length > max)
    throw new BadRequestException('Invalid configuration row');
  return value;
}
function uuid(value: unknown): string {
  const result = field(value, 36);
  if (!uuidPattern.test(result))
    throw new BadRequestException('Invalid configuration ID');
  return result.toLowerCase();
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean')
    throw new BadRequestException('Invalid configuration flag');
  return value;
}
function revision(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > 2147483647
  ) {
    throw new BadRequestException('Invalid configuration revision');
  }
  return value;
}
function minor(value: unknown, max: number): string {
  const result = field(value, 13);
  if (!/^(0|[1-9][0-9]*)$/.test(result) || Number(result) > max) {
    throw new BadRequestException('Invalid configuration money or quantity');
  }
  return result;
}
function optionalText(value: unknown, max: number): string | null {
  return value === null ? null : field(value, max);
}

async function applyEvent(
  client: PoolClient,
  event: ConfigurationEvent,
): Promise<void> {
  const data = event.payload;
  if (event.operation === 'delete') {
    if (event.entity === 'staff') {
      await client.query(
        'UPDATE "user" SET disabled = true, "emailVerified" = false WHERE id = $1',
        [event.entityId],
      );
      await client.query('DELETE FROM session WHERE "userId" = $1', [
        event.entityId,
      ]);
    } else if (event.entity === 'category') {
      await client.query('DELETE FROM catalogue_category WHERE id = $1', [
        uuid(event.entityId),
      ]);
    } else if (event.entity === 'product') {
      await client.query(
        'UPDATE catalogue_product SET active = false WHERE id = $1',
        [uuid(event.entityId)],
      );
    } else {
      await client.query('DELETE FROM catalogue_barcode WHERE code = $1', [
        field(event.entityId, 64),
      ]);
    }
    return;
  }
  if (event.entity === 'staff') {
    const id = field(data.id, 200);
    const name = field(data.name, 100);
    const email = field(data.email).toLowerCase();
    const role = data.role;
    const disabled = flag(data.disabled);
    const hostedVerified = flag(data.emailVerified);
    if (
      id !== event.entityId ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      (role !== 'manager' && role !== 'cashier')
    )
      throw new BadRequestException('Invalid staff change');
    const account = await client.query(
      'SELECT 1 FROM account WHERE "userId" = $1 LIMIT 1',
      [id],
    );
    const localVerified =
      Boolean(account.rowCount) && hostedVerified && !disabled;
    await client.query(
      `INSERT INTO "user" (id,name,email,role,disabled,"emailVerified")
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,
        role=EXCLUDED.role,disabled=EXCLUDED.disabled,"emailVerified"=EXCLUDED."emailVerified",
        "updatedAt"=now()`,
      [id, name, email, role, disabled || !hostedVerified, localVerified],
    );
    await client.query('DELETE FROM session WHERE "userId" = $1', [id]);
  } else if (event.entity === 'category') {
    const id = uuid(data.id);
    const name = field(data.name, 80);
    const nextRevision = revision(data.revision);
    if (id !== event.entityId)
      throw new BadRequestException('Invalid category change');
    const previous = await client.query<{ revision: number }>(
      'SELECT revision FROM catalogue_category WHERE id = $1',
      [id],
    );
    if (nextRevision !== (previous.rows[0]?.revision ?? 0) + 1) {
      throw new ConflictException('Category revision is out of order');
    }
    await client.query(
      `INSERT INTO catalogue_category (id,name,revision) VALUES ($1,$2,$3)
      ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,revision=EXCLUDED.revision`,
      [id, name, nextRevision],
    );
  } else if (event.entity === 'product') {
    const id = uuid(data.id);
    const sku = field(data.sku, 40);
    const name = field(data.name, 160);
    const categoryId = data.categoryId === null ? null : uuid(data.categoryId);
    const unit = data.unit;
    const priceMinor = minor(data.priceMinor, 999999999);
    const taxCode = optionalText(data.taxCode, 40);
    const active = flag(data.active);
    const nextRevision = revision(data.revision);
    const threshold =
      data.lowStockThresholdMinor === null
        ? null
        : minor(data.lowStockThresholdMinor, 999999999999);
    if (
      id !== event.entityId ||
      !/^[A-Z0-9][A-Z0-9._-]{0,39}$/.test(sku) ||
      (unit !== 'each' && unit !== 'pack' && unit !== 'kg' && unit !== 'l')
    ) {
      throw new BadRequestException('Invalid product change');
    }
    const previous = await client.query<{ unit: string; revision: number }>(
      'SELECT unit, revision FROM catalogue_product WHERE id = $1',
      [id],
    );
    if (
      (previous.rows[0] && previous.rows[0].unit !== unit) ||
      nextRevision !== (previous.rows[0]?.revision ?? 0) + 1
    ) {
      throw new ConflictException('Product revision or unit is incompatible');
    }
    await client.query(
      `INSERT INTO catalogue_product
      (id,sku,name,category_id,unit,price_minor,tax_code,active,revision,low_stock_threshold_minor)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (id) DO UPDATE SET sku=EXCLUDED.sku,name=EXCLUDED.name,
        category_id=EXCLUDED.category_id,price_minor=EXCLUDED.price_minor,
        tax_code=EXCLUDED.tax_code,active=EXCLUDED.active,revision=EXCLUDED.revision,
        low_stock_threshold_minor=EXCLUDED.low_stock_threshold_minor,updated_at=now()`,
      [
        id,
        sku,
        name,
        categoryId,
        unit,
        priceMinor,
        taxCode,
        active,
        nextRevision,
        threshold,
      ],
    );
  } else {
    const code = field(data.code, 64);
    const productId = uuid(data.productId);
    if (code !== event.entityId || !/^[A-Za-z0-9._-]{1,64}$/.test(code)) {
      throw new BadRequestException('Invalid barcode change');
    }
    await client.query(
      `INSERT INTO catalogue_barcode (code,product_id) VALUES ($1,$2)
      ON CONFLICT (code) DO UPDATE SET product_id=EXCLUDED.product_id`,
      [code, productId],
    );
  }
}

export async function applyConfigurationBatch(
  pool: Pool,
  config: AppConfig,
  value: unknown,
): Promise<'applied' | 'duplicate'> {
  if (
    config.runtime.mode !== 'edge' ||
    !config.runtime.storeId ||
    !config.bootstrap?.secret
  ) {
    throw new ConflictException('Edge configuration is unavailable');
  }
  const batch = verifyConfigurationBatch(value, config.bootstrap.secret);
  if (batch.storeId !== config.runtime.storeId)
    throw new ConflictException('Store identity does not match');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await client.query<{
      generation: number;
      configuration_version: string;
      configuration_digest: string;
      last_roster_check_at: Date | null;
    }>(
      "SELECT * FROM store_bootstrap_state WHERE store_id = $1 AND runtime_mode = 'edge' FOR UPDATE",
      [batch.storeId],
    );
    const current = state.rows[0];
    const application = await client.query(
      'SELECT 1 FROM store_bootstrap_application WHERE store_id = $1',
      [batch.storeId],
    );
    if (
      !current ||
      !application.rowCount ||
      current.generation !== batch.generation
    ) {
      throw new ConflictException(
        'Edge bootstrap or generation does not match',
      );
    }
    if (
      current.last_roster_check_at &&
      current.last_roster_check_at.getTime() > Date.now()
    ) {
      throw new ConflictException('Local clock moved backwards');
    }
    const version = Number(current.configuration_version);
    if (!Number.isSafeInteger(version))
      throw new ConflictException('Configuration version is too large');
    if (
      version === batch.toVersion &&
      current.configuration_digest === batch.toDigest &&
      batch.events.length > 0
    ) {
      const receipts = await client.query<{ version: string; digest: string }>(
        'SELECT version::text, digest FROM store_configuration_applied WHERE store_id = $1 AND version > $2 AND version <= $3 ORDER BY version',
        [batch.storeId, batch.fromVersion, batch.toVersion],
      );
      if (
        receipts.rows.length === batch.events.length &&
        receipts.rows.every(
          (row, index) =>
            Number(row.version) === batch.events[index].version &&
            row.digest === batch.events[index].digest,
        )
      ) {
        await client.query('COMMIT');
        return 'duplicate';
      }
    }
    if (
      version !== batch.fromVersion ||
      current.configuration_digest !== batch.fromDigest
    ) {
      throw new ConflictException('Configuration cursor is out of order');
    }
    for (const event of batch.events) {
      await client.query("SELECT set_config('paygo.actor_id', $1, true)", [
        event.actorId ?? 'hosted-configuration',
      ]);
      await client.query("SELECT set_config('paygo.reason', $1, true)", [
        event.reason ?? 'Hosted configuration',
      ]);
      await applyEvent(client, event);
      await client.query(
        `UPDATE store_bootstrap_state SET configuration_version = $1,
        configuration_digest = $2, updated_at = now() WHERE store_id = $3`,
        [event.version, event.digest, batch.storeId],
      );
      await client.query(
        `INSERT INTO store_configuration_applied
        (store_id,version,digest,entity,operation,entity_id,payload,actor_id,reason)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          batch.storeId,
          event.version,
          event.digest,
          event.entity,
          event.operation,
          event.entityId,
          JSON.stringify(event.payload),
          event.actorId,
          event.reason,
        ],
      );
    }
    await client.query(
      'UPDATE store_bootstrap_state SET last_roster_check_at = now(), updated_at = now() WHERE store_id = $1',
      [batch.storeId],
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

@Injectable()
export class EdgeConfigurationService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'connectionPool'>,
  ) {}

  async checkpoint() {
    if (this.config.runtime.mode !== 'edge' || !this.config.runtime.storeId) {
      throw new ConflictException('Edge configuration is unavailable');
    }
    const result = await this.database.connectionPool.query<{
      store_id: string;
      generation: number;
      configuration_version: string;
      configuration_digest: string;
      last_roster_check_at: Date | null;
    }>(
      `SELECT s.store_id, s.generation, s.configuration_version::text,
        s.configuration_digest, s.last_roster_check_at
      FROM store_bootstrap_state s JOIN store_bootstrap_application a
        ON a.store_id = s.store_id WHERE s.store_id = $1 AND s.runtime_mode = 'edge'`,
      [this.config.runtime.storeId],
    );
    const row = result.rows[0];
    if (!row) throw new ConflictException('Edge snapshot has not been applied');
    return {
      storeId: row.store_id,
      generation: row.generation,
      version: Number(row.configuration_version),
      digest: row.configuration_digest,
      lastRosterCheckAt: row.last_roster_check_at?.toISOString() ?? null,
    };
  }
}
