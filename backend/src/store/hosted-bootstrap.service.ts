import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import {
  bootstrapDigest,
  parseBootstrapPayload,
  signBootstrapBundle,
  type BootstrapBundle,
} from './bootstrap-bundle.js';
import { StoreAuthorityService } from './store-authority.service.js';

@Injectable()
export class HostedBootstrapService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DatabaseService)
    private readonly database: Pick<DatabaseService, 'connectionPool'>,
    @Inject(StoreAuthorityService)
    private readonly authority: StoreAuthorityService,
  ) {}

  async publish(actorIdentity: {
    userId: string;
    sessionId: string;
  }): Promise<BootstrapBundle> {
    const storeId = this.config.sync?.storeId;
    const secret = this.config.bootstrap?.secret;
    if (this.config.runtime.mode !== 'hosted' || !storeId || !secret) {
      throw new ServiceUnavailableException(
        'Hosted bootstrap publication is not configured',
      );
    }
    await this.authority.initialize(storeId);
    const client = await this.database.connectionPool.connect();
    try {
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
      const actor = await client.query<{ id: string }>(
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
      const state = await client.query<{
        store_id: string;
        runtime_mode: string;
        checkout_authority: string;
        generation: number;
        configuration_version: string;
        configuration_digest: string | null;
      }>('SELECT * FROM store_bootstrap_state WHERE singleton FOR UPDATE');
      const current = state.rows[0];
      if (
        !current ||
        current.store_id !== storeId ||
        current.runtime_mode !== 'hosted' ||
        current.checkout_authority !== 'hosted'
      ) {
        throw new ConflictException(
          'Hosted store is not available for bootstrap',
        );
      }
      const staff = await client.query(`SELECT id, name, email, role, disabled,
          "emailVerified" AS "emailVerified" FROM "user" ORDER BY id`);
      const categories = await client.query(
        'SELECT id, name, revision FROM catalogue_category ORDER BY id',
      );
      const products =
        await client.query(`SELECT id, sku, name, category_id AS "categoryId", unit,
          price_minor::text AS "priceMinor", tax_code AS "taxCode", active, revision,
          low_stock_threshold_minor::text AS "lowStockThresholdMinor"
          FROM catalogue_product ORDER BY id`);
      const barcodes = await client.query(
        'SELECT code, product_id AS "productId" FROM catalogue_barcode ORDER BY code',
      );
      const stock =
        await client.query(`SELECT p.id AS "productId", COALESCE(s.quantity_minor, 0)::text AS "quantityMinor"
          FROM catalogue_product p LEFT JOIN inventory_stock s ON s.product_id = p.id ORDER BY p.id`);
      const payload = parseBootstrapPayload({
        staff: staff.rows,
        categories: categories.rows,
        products: products.rows,
        barcodes: barcodes.rows,
        proposedStock: stock.rows,
      });
      const digest = bootstrapDigest(payload);
      const previousVersion = Number(current.configuration_version);
      if (
        !Number.isSafeInteger(previousVersion) ||
        previousVersion >= Number.MAX_SAFE_INTEGER
      ) {
        throw new ConflictException('Configuration version is too large');
      }
      if (
        previousVersion > 1 ||
        (previousVersion === 1 && current.configuration_digest !== digest)
      ) {
        throw new ConflictException(
          'Initial snapshot is already published; use configuration changes',
        );
      }
      const configurationVersion =
        current.configuration_digest === digest && previousVersion > 0
          ? previousVersion
          : previousVersion + 1;
      if (configurationVersion !== previousVersion) {
        await client.query(
          `UPDATE store_bootstrap_state SET configuration_version = $1,
          configuration_digest = $2, updated_at = now() WHERE singleton`,
          [configurationVersion, digest],
        );
      }
      const createdAt = new Date();
      const bundle = signBootstrapBundle(
        {
          schemaVersion: 1,
          publicationId: randomUUID(),
          storeId,
          generation: current.generation,
          configurationVersion,
          publisherId: actorIdentity.userId,
          createdAt: createdAt.toISOString(),
          expiresAt: new Date(createdAt.getTime() + 15 * 60_000).toISOString(),
          digest,
          payload,
        },
        secret,
      );
      if (Buffer.byteLength(JSON.stringify(bundle)) > 8_000_000) {
        throw new ConflictException(
          'Bootstrap snapshot exceeds the transfer limit',
        );
      }
      await client.query(
        `INSERT INTO store_bootstrap_publication
        (id, store_id, generation, configuration_version, digest, signature,
         payload, publisher_id, created_at, expires_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          bundle.publicationId,
          storeId,
          bundle.generation,
          bundle.configurationVersion,
          digest,
          bundle.signature,
          JSON.stringify(payload),
          bundle.publisherId,
          bundle.createdAt,
          bundle.expiresAt,
        ],
      );
      await client.query(
        `INSERT INTO store_bootstrap_audit
        (store_id, action, actor_id, detail) VALUES ($1, 'snapshot.published', $2, $3)`,
        [
          storeId,
          bundle.publisherId,
          JSON.stringify({
            publicationId: bundle.publicationId,
            configurationVersion,
            digest,
          }),
        ],
      );
      await client.query('COMMIT');
      return bundle;
    } catch (error) {
      await client.query('ROLLBACK');
      if (
        error instanceof ConflictException ||
        error instanceof ForbiddenException ||
        error instanceof ServiceUnavailableException
      )
        throw error;
      throw new ServiceUnavailableException('Bootstrap publication failed');
    } finally {
      client.release();
    }
  }
}
