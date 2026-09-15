import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { CatalogueWrites, type CatalogueActor } from './catalogue-writes.js';
import {
  commandInput,
  objectInput,
  pageInput,
  productInput,
  revisionInput,
  textInput,
  uuidInput,
} from './catalogue.input.js';
import {
  productColumns,
  productFrom,
  type Category,
  type Product,
} from './catalogue.types.js';
import {
  insertProduct,
  readProduct,
  recordHistory,
  replaceBarcodes,
} from './catalogue.repository.js';

@Injectable()
export class CatalogueService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogueWrites) private readonly writes: CatalogueWrites,
  ) {}

  async categories() {
    try {
      const result = await this.database.connectionPool.query<Category>(
        'SELECT id, name, revision FROM catalogue_category ORDER BY lower(name), id LIMIT 1001',
      );
      if (result.rows.length > 1000) throw new Error('Category limit exceeded');
      return { categories: result.rows };
    } catch {
      throw new ServiceUnavailableException(
        'Categories are unavailable. Please retry.',
      );
    }
  }

  async products(query: Record<string, unknown>, manager: boolean) {
    const search =
      query.search === undefined || query.search === ''
        ? ''
        : textInput(query.search, 'search', 160);
    const page = pageInput(query.page);
    const status = query.status ?? 'active';
    if (
      typeof status !== 'string' ||
      !['active', 'archived', 'all'].includes(status)
    )
      throw new BadRequestException('Invalid product status');
    if (!manager && status !== 'active')
      throw new ForbiddenException('Only managers can view archived products');
    const category =
      query.categoryId === undefined || query.categoryId === ''
        ? null
        : uuidInput(query.categoryId, 'category');
    try {
      const result = await this.database.connectionPool.query<Product>(
        `SELECT ${productColumns} FROM ${productFrom}
        WHERE ($1 = 'all' OR p.active = ($1 = 'active')) AND ($2::uuid IS NULL OR p.category_id = $2)
        AND ($3 = '' OR strpos(lower(p.name || ' ' || p.sku), lower($3)) > 0
          OR EXISTS(SELECT 1 FROM catalogue_barcode b WHERE b.product_id = p.id AND b.code = $3))
        ORDER BY lower(p.name), p.id LIMIT 51 OFFSET $4`,
        [status, category, search, page * 50],
      );
      return {
        products: result.rows.slice(0, 50),
        hasMore: result.rows.length > 50,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Products are unavailable. Please retry.',
      );
    }
  }

  async barcode(value: unknown) {
    const code = textInput(value, 'barcode', 64);
    let product: Product | undefined;
    try {
      const result = await this.database.connectionPool.query<Product>(
        `SELECT ${productColumns} FROM ${productFrom}
        WHERE p.active AND EXISTS(SELECT 1 FROM catalogue_barcode b WHERE b.product_id = p.id AND b.code = $1)`,
        [code],
      );
      product = result.rows[0];
    } catch {
      throw new ServiceUnavailableException(
        'Barcode lookup is unavailable. Please retry.',
      );
    }
    if (!product)
      throw new NotFoundException('No active product has this barcode');
    return { product };
  }

  createProduct(actor: CatalogueActor, value: unknown) {
    const input = productInput(value),
      command = commandInput(value);
    return this.writes.execute(
      actor,
      command,
      { action: 'product.create', input, reason: command.reason },
      async (client) => ({
        product: await insertProduct(client, actor, command.reason, input),
      }),
    );
  }

  updateProduct(actor: CatalogueActor, idValue: string, value: unknown) {
    const id = uuidInput(idValue),
      input = productInput(value),
      command = commandInput(value);
    const revision = revisionInput(objectInput(value).revision);
    return this.writes.execute(
      actor,
      command,
      { action: 'product.update', id, revision, input, reason: command.reason },
      async (client) => {
        const existing = await client.query<{ unit: string; revision: number }>(
          'SELECT unit, revision FROM catalogue_product WHERE id = $1 FOR UPDATE',
          [id],
        );
        const previous = existing.rows[0];
        if (!previous) throw new NotFoundException('Product not found');
        if (previous.revision !== revision)
          throw new ConflictException(
            'This product changed. Reload before editing.',
          );
        if (previous.unit !== input.unit)
          throw new ConflictException(
            'The sales unit cannot change. Create a separate product for a different unit.',
          );
        await client.query(
          `UPDATE catalogue_product SET sku = $1, name = $2, category_id = $3, price_minor = $4,
        tax_code = $5, active = $6, revision = revision + 1, updated_at = now() WHERE id = $7`,
          [
            input.sku,
            input.name,
            input.categoryId,
            input.priceMinor,
            input.taxCode,
            input.active,
            id,
          ],
        );
        await replaceBarcodes(client, id, input.barcodes);
        const product = await readProduct(client, id);
        await recordHistory(client, actor, command.reason, 'product', product);
        return { product };
      },
    );
  }

  saveCategory(actor: CatalogueActor, idValue: string | null, value: unknown) {
    const body = objectInput(value),
      command = commandInput(value);
    const name = textInput(body.name, 'category name', 80);
    const id = idValue ? uuidInput(idValue) : null;
    const revision = id ? revisionInput(body.revision) : null;
    return this.writes.execute(
      actor,
      command,
      { action: 'category.save', id, revision, name, reason: command.reason },
      async (client) => {
        // Bounded catalogue categories; this lock also serializes the capacity check.
        await client.query('SELECT pg_advisory_xact_lock(20260916, 1)');
        let category: Category | undefined;
        if (id) {
          const result = await client.query<Category>(
            'UPDATE catalogue_category SET name = $1, revision = revision + 1 WHERE id = $2 AND revision = $3 RETURNING id, name, revision',
            [name, id, revision],
          );
          category = result.rows[0];
          if (!category)
            throw new ConflictException(
              'This category changed or is unavailable. Reload before editing.',
            );
        } else {
          const count = await client.query<{ count: string }>(
            'SELECT count(*)::text AS count FROM catalogue_category',
          );
          if (Number(count.rows[0].count) >= 1000)
            throw new ConflictException(
              'The catalogue supports up to 1,000 categories',
            );
          const result = await client.query<Category>(
            'INSERT INTO catalogue_category (id, name) VALUES ($1, $2) RETURNING id, name, revision',
            [randomUUID(), name],
          );
          category = result.rows[0];
        }
        if (!category) throw new Error('Category write returned no row');
        await recordHistory(
          client,
          actor,
          command.reason,
          'category',
          category,
        );
        return { category };
      },
    );
  }

  async history(idValue: string, pageValue: unknown) {
    const id = uuidInput(idValue),
      page = pageInput(pageValue);
    try {
      const result = await this.database.connectionPool.query(
        `SELECT h.id::text, h.revision, h.reason, h.snapshot,
        h.created_at AS "createdAt", u.name AS "actorName" FROM catalogue_history h JOIN "user" u ON u.id = h.actor_id
        WHERE h.entity_type = 'product' AND h.entity_id = $1 ORDER BY h.revision DESC LIMIT 51 OFFSET $2`,
        [id, page * 50],
      );
      return {
        history: result.rows.slice(0, 50),
        hasMore: result.rows.length > 50,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Product history is unavailable. Please retry.',
      );
    }
  }
}
