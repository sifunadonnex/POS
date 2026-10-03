import { createHash, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { hashPassword } from 'better-auth/crypto';
import type { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { canonicalJson } from '../sync/sync-auth.js';
import {
  parseBootstrapPayload,
  verifyBootstrapBundle,
  type BootstrapStock,
} from './bootstrap-bundle.js';

const emptyTables = [
  '"user"',
  'catalogue_category',
  'catalogue_product',
  'catalogue_barcode',
  'inventory_stock',
  'inventory_movement',
  'sale',
  'cash_shift',
  'cash_movement',
  'sale_return',
  'purchase_receipt',
  'purchase_return',
  'stocktake',
  'payment_attempt',
  'suspended_order',
  'sync_outbox',
];
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireEdge(config: AppConfig): { storeId: string; secret: string } {
  if (
    config.runtime.mode !== 'edge' ||
    !config.runtime.storeId ||
    !config.bootstrap?.secret
  ) {
    throw new ServiceUnavailableException('Edge bootstrap is not configured');
  }
  return { storeId: config.runtime.storeId, secret: config.bootstrap.secret };
}

export async function applyBootstrapBundle(
  pool: Pool,
  config: AppConfig,
  value: unknown,
): Promise<'applied' | 'duplicate'> {
  const edge = requireEdge(config);
  const bundle = verifyBootstrapBundle(value, edge.secret);
  if (
    bundle.storeId !== edge.storeId ||
    (config.sync && config.sync.storeId !== bundle.storeId)
  ) {
    throw new ConflictException(
      'Bootstrap store identity does not match this edge',
    );
  }
  if (bundle.generation !== 1) {
    throw new ConflictException(
      'A replacement generation requires restored edge history',
    );
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await client.query<{
      store_id: string;
      runtime_mode: string;
      generation: number;
      configuration_version: string;
      configuration_digest: string | null;
    }>('SELECT * FROM store_bootstrap_state WHERE singleton FOR UPDATE');
    const prior = state.rows[0];
    const application = await client.query<{
      publication_id: string;
      digest: string;
    }>(
      'SELECT publication_id, digest FROM store_bootstrap_application WHERE store_id = $1',
      [bundle.storeId],
    );
    if (application.rows[0]) {
      if (
        prior?.generation === bundle.generation &&
        Number(prior.configuration_version) === bundle.configurationVersion &&
        application.rows[0].publication_id === bundle.publicationId &&
        application.rows[0].digest === bundle.digest
      ) {
        await client.query('COMMIT');
        return 'duplicate';
      }
      throw new ConflictException(
        'Edge already has a different bootstrap publication',
      );
    }
    if (
      prior &&
      (prior.store_id !== bundle.storeId ||
        prior.runtime_mode !== 'edge' ||
        prior.generation !== bundle.generation ||
        Number(prior.configuration_version) !== 0 ||
        prior.configuration_digest !== null)
    ) {
      throw new ConflictException(
        'Edge checkpoint is incompatible with this publication',
      );
    }
    await client.query(
      `LOCK TABLE ${emptyTables.join(', ')} IN SHARE ROW EXCLUSIVE MODE`,
    );
    const occupied = await client.query(
      `SELECT ${emptyTables
        .map((table) => `EXISTS (SELECT 1 FROM ${table})`)
        .join(' OR ')} AS occupied`,
    );
    if (occupied.rows[0]?.occupied) {
      throw new ConflictException(
        'Edge business database must be empty for initial apply',
      );
    }
    if (!prior) {
      await client.query(
        `INSERT INTO store_bootstrap_state
        (singleton, store_id, runtime_mode, checkout_authority, generation,
         configuration_version, configuration_digest)
        VALUES (true, $1, 'edge', 'local', $2, $3, $4)`,
        [
          bundle.storeId,
          bundle.generation,
          bundle.configurationVersion,
          bundle.digest,
        ],
      );
    } else {
      if (bundle.configurationVersion !== 1) {
        throw new ConflictException(
          'An existing edge checkpoint requires the first version',
        );
      }
      await client.query(
        `UPDATE store_bootstrap_state SET configuration_version = $1,
        configuration_digest = $2, updated_at = now() WHERE singleton`,
        [bundle.configurationVersion, bundle.digest],
      );
    }
    await client.query("SELECT set_config('paygo.actor_id', $1, true)", [
      bundle.publisherId,
    ]);
    for (const row of bundle.payload.staff) {
      await client.query(
        `INSERT INTO "user" (id, name, email, role, disabled, "emailVerified")
        VALUES ($1,$2,$3,$4,$5,false)`,
        [
          row.id,
          row.name,
          row.email,
          row.role,
          row.disabled || !row.emailVerified,
        ],
      );
    }
    for (const row of bundle.payload.categories) {
      await client.query(
        'INSERT INTO catalogue_category (id, name, revision) VALUES ($1,$2,$3)',
        [row.id, row.name, row.revision],
      );
    }
    for (const row of bundle.payload.products) {
      await client.query(
        `INSERT INTO catalogue_product
        (id, sku, name, category_id, unit, price_minor, tax_code, active, revision,
         low_stock_threshold_minor) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          row.id,
          row.sku,
          row.name,
          row.categoryId,
          row.unit,
          row.priceMinor,
          row.taxCode,
          row.active,
          row.revision,
          row.lowStockThresholdMinor,
        ],
      );
    }
    for (const row of bundle.payload.barcodes) {
      await client.query(
        'INSERT INTO catalogue_barcode (code, product_id) VALUES ($1,$2)',
        [row.code, row.productId],
      );
    }
    await client.query(
      `INSERT INTO store_bootstrap_application
      (store_id, publication_id, digest, publisher_id, snapshot_payload, proposed_stock)
      VALUES ($1,$2,$3,$4,$5,$6)`,
      [
        bundle.storeId,
        bundle.publicationId,
        bundle.digest,
        bundle.publisherId,
        JSON.stringify(bundle.payload),
        JSON.stringify(bundle.payload.proposedStock),
      ],
    );
    await client.query(
      `INSERT INTO store_bootstrap_audit
      (store_id, action, actor_id, detail) VALUES ($1, 'snapshot.applied', $2, $3)`,
      [
        bundle.storeId,
        bundle.publisherId,
        JSON.stringify({
          publicationId: bundle.publicationId,
          configurationVersion: bundle.configurationVersion,
          digest: bundle.digest,
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

export type ManagerEnrollment = {
  email: string;
  password: string;
  attestIdentity: boolean;
  attestEmailControl: boolean;
  witnessedBy: string;
};

export async function enrollBootstrapManager(
  pool: Pool,
  config: AppConfig,
  input: ManagerEnrollment,
  hash: (password: string) => Promise<string> = hashPassword,
): Promise<void> {
  const edge = requireEdge(config);
  if (
    !input.attestIdentity ||
    !input.attestEmailControl ||
    !input.witnessedBy?.trim() ||
    input.witnessedBy.length > 100 ||
    input.password.length < 12 ||
    input.password.length > 128 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)
  ) {
    throw new BadRequestException(
      'Manager enrollment attestation or credential is invalid',
    );
  }
  const password = await hash(input.password);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const application = await client.query<{
      publisher_id: string;
      snapshot_payload: unknown;
      manager_enrolled_at: Date | null;
    }>(
      'SELECT * FROM store_bootstrap_application WHERE store_id = $1 FOR UPDATE',
      [edge.storeId],
    );
    const applied = application.rows[0];
    if (!applied || applied.manager_enrolled_at)
      throw new ConflictException('Manager enrollment is unavailable');
    const bundle = parseBootstrapPayload(applied.snapshot_payload);
    const manager = bundle.staff.find(
      (row) =>
        row.id === applied.publisher_id &&
        row.email === input.email.trim().toLowerCase() &&
        row.role === 'manager' &&
        !row.disabled &&
        row.emailVerified,
    );
    if (!manager)
      throw new ForbiddenException(
        'Manager does not match the published roster',
      );
    const existing = await client.query(
      'SELECT id FROM account WHERE "userId" = $1',
      [manager.id],
    );
    if (existing.rowCount)
      throw new ConflictException('Manager already has local credentials');
    await client.query("SELECT set_config('paygo.actor_id', $1, true)", [
      input.witnessedBy.trim(),
    ]);
    await client.query(
      'UPDATE "user" SET "emailVerified" = true WHERE id = $1 AND NOT disabled',
      [manager.id],
    );
    await client.query(
      `INSERT INTO account (id, "userId", "accountId", "providerId", password)
      VALUES ($1,$2,$2,'credential',$3)`,
      [randomUUID(), manager.id, password],
    );
    await client.query(
      `UPDATE store_bootstrap_application SET manager_enrolled_at = now()
      WHERE store_id = $1`,
      [edge.storeId],
    );
    await client.query(
      `INSERT INTO store_bootstrap_audit
      (store_id, action, actor_id, detail) VALUES ($1, 'manager.enrolled', $2, $3)`,
      [
        edge.storeId,
        manager.id,
        JSON.stringify({
          witnessedBy: input.witnessedBy.trim(),
          identityAttested: true,
          emailControlAttested: true,
        }),
      ],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

function parseOpening(value: unknown): {
  requestId: string;
  counts: BootstrapStock[];
} {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new BadRequestException('Invalid opening count');
  const raw = value as Record<string, unknown>;
  if (
    typeof raw.requestId !== 'string' ||
    !uuidPattern.test(raw.requestId) ||
    !Array.isArray(raw.counts) ||
    raw.counts.length > 20000
  ) {
    throw new BadRequestException('Invalid opening count');
  }
  const counts = raw.counts.map((value): BootstrapStock => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('Invalid opening count');
    const row = value as Record<string, unknown>;
    if (
      typeof row.productId !== 'string' ||
      !uuidPattern.test(row.productId) ||
      typeof row.quantityMinor !== 'string' ||
      !/^(0|[1-9][0-9]{0,11})$/.test(row.quantityMinor) ||
      Number(row.quantityMinor) > 999999999999
    )
      throw new BadRequestException('Invalid opening count');
    return {
      productId: row.productId.toLowerCase(),
      quantityMinor: row.quantityMinor,
    };
  });
  if (new Set(counts.map((row) => row.productId)).size !== counts.length) {
    throw new BadRequestException('Duplicate opening product');
  }
  return {
    requestId: raw.requestId.toLowerCase(),
    counts: counts.sort((a, b) => a.productId.localeCompare(b.productId)),
  };
}

@Injectable()
export class EdgeBootstrapService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'connectionPool'>,
  ) {}

  async signOffOpening(
    actorIdentity: { userId: string; sessionId: string },
    value: unknown,
  ): Promise<{ status: 'applied' | 'duplicate' }> {
    const edge = requireEdge(this.config);
    const input = parseOpening(value);
    const digest = createHash('sha256')
      .update(canonicalJson(input.counts))
      .digest('hex');
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN');
      const application = await client.query<{
        proposed_stock: BootstrapStock[];
        opening_request_id: string | null;
        opening_digest: string | null;
        manager_enrolled_at: Date | null;
      }>(
        'SELECT * FROM store_bootstrap_application WHERE store_id = $1 FOR UPDATE',
        [edge.storeId],
      );
      const applied = application.rows[0];
      if (!applied || !applied.manager_enrolled_at)
        throw new ConflictException('Local manager must enroll first');
      const actor = await client.query(
        `SELECT u.id FROM "user" u JOIN session s ON s."userId" = u.id
        WHERE u.id = $1 AND s.id = $2 AND u.role = 'manager' AND NOT u.disabled
          AND u."emailVerified" AND u."twoFactorEnabled" AND s."mfaVerified"
          AND s."expiresAt" > now()
          AND s."lastActivityAt" > now() - interval '15 minutes'
          FOR SHARE OF u, s`,
        [actorIdentity.userId, actorIdentity.sessionId],
      );
      if (!actor.rowCount)
        throw new ForbiddenException('Manager MFA is required');
      if (applied.opening_request_id) {
        if (
          applied.opening_request_id !== input.requestId ||
          applied.opening_digest !== digest
        ) {
          throw new ConflictException(
            'Opening stock has already been signed off',
          );
        }
        await client.query('COMMIT');
        return { status: 'duplicate' };
      }
      const state = await client.query<{
        generation: number;
        opening_stock_at: Date | null;
      }>(
        `SELECT generation, opening_stock_at FROM store_bootstrap_state
         WHERE store_id = $1 AND runtime_mode = 'edge' FOR UPDATE`,
        [edge.storeId],
      );
      if (!state.rows[0] || state.rows[0].opening_stock_at) {
        throw new ConflictException('Opening stock checkpoint is unavailable');
      }
      const products = await client.query<{ id: string; unit: string }>(
        'SELECT id, unit FROM catalogue_product ORDER BY id',
      );
      const expected = new Map(products.rows.map((row) => [row.id, row.unit]));
      if (
        input.counts.length !== expected.size ||
        input.counts.some((row) => !expected.has(row.productId))
      ) {
        throw new BadRequestException(
          'Opening counts must include every product',
        );
      }
      const operational = await client.query(`SELECT
        EXISTS (SELECT 1 FROM inventory_stock) OR EXISTS (SELECT 1 FROM inventory_movement)
        OR EXISTS (SELECT 1 FROM sale) OR EXISTS (SELECT 1 FROM cash_shift)
        OR EXISTS (SELECT 1 FROM sync_outbox) AS occupied`);
      if (operational.rows[0]?.occupied)
        throw new ConflictException('Operational activity already exists');
      const proposed = new Map(
        applied.proposed_stock.map((row) => [row.productId, row.quantityMinor]),
      );
      const variance: Array<{
        productId: string;
        proposedMinor: string;
        countedMinor: string;
      }> = [];
      for (const row of input.counts) {
        const unit = expected.get(row.productId);
        await client.query(
          `INSERT INTO inventory_stock (product_id, unit, quantity_minor)
          VALUES ($1,$2,$3)`,
          [row.productId, unit, row.quantityMinor],
        );
        if (row.quantityMinor !== '0') {
          await client.query(
            `INSERT INTO inventory_movement
            (id, product_id, kind, delta_minor, quantity_after_minor, actor_id, reason)
            VALUES ($1,$2,'opening',$3,$3,$4,'Bootstrap opening count')`,
            [
              randomUUID(),
              row.productId,
              row.quantityMinor,
              actorIdentity.userId,
            ],
          );
        }
        if (proposed.get(row.productId) !== row.quantityMinor) {
          variance.push({
            productId: row.productId,
            proposedMinor: proposed.get(row.productId) ?? '0',
            countedMinor: row.quantityMinor,
          });
        }
      }
      await client.query(
        `UPDATE store_bootstrap_application SET opening_request_id = $1,
        opening_digest = $2, opening_actor_id = $3, opening_at = now() WHERE store_id = $4`,
        [input.requestId, digest, actorIdentity.userId, edge.storeId],
      );
      await client.query(
        'UPDATE store_bootstrap_state SET opening_stock_at = now(), updated_at = now() WHERE store_id = $1',
        [edge.storeId],
      );
      await client.query(
        `INSERT INTO store_bootstrap_audit
        (store_id, action, actor_id, detail) VALUES ($1,'opening.signed-off',$2,$3)`,
        [
          edge.storeId,
          actorIdentity.userId,
          JSON.stringify({
            requestId: input.requestId,
            digest,
            generation: state.rows[0].generation,
            variance,
          }),
        ],
      );
      await client.query('COMMIT');
      return { status: 'applied' };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
