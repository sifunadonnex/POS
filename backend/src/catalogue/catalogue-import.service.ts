import {
  BadRequestException,
  HttpException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Pool, PoolClient } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import { CatalogueWrites, type CatalogueActor } from './catalogue-writes.js';
import { commandInput, objectInput } from './catalogue.input.js';
import { csvText, parseCatalogueCsv } from './catalogue-csv.js';
import { insertProduct } from './catalogue.repository.js';

@Injectable()
export class CatalogueImportService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(CatalogueWrites) private readonly writes: CatalogueWrites,
  ) {}

  private async prepare(client: Pool | PoolClient, csv: string) {
    const rows = parseCatalogueCsv(csv);
    const categories = await client.query<{ id: string; key: string }>(
      'SELECT id, lower(name) AS key FROM catalogue_category WHERE lower(name) = ANY($1::text[])',
      [rows.map((row) => row.categoryName.toLowerCase()).filter(Boolean)],
    );
    const skus = await client.query<{ sku: string }>(
      'SELECT sku FROM catalogue_product WHERE sku = ANY($1::text[])',
      [rows.flatMap((row) => (row.input ? [row.input.sku] : []))],
    );
    const barcodes = await client.query<{ code: string }>(
      'SELECT code FROM catalogue_barcode WHERE code = ANY($1::text[])',
      [rows.flatMap((row) => row.input?.barcodes ?? [])],
    );
    const categoryMap = new Map(
      categories.rows.map((row) => [row.key, row.id]),
    );
    const existingSkus = new Set(skus.rows.map((row) => row.sku)),
      existingCodes = new Set(barcodes.rows.map((row) => row.code));
    for (const row of rows) {
      if (!row.input) continue;
      if (row.categoryName) {
        const id = categoryMap.get(row.categoryName.toLowerCase());
        if (id) row.input.categoryId = id;
        else row.errors.push('Create this category before importing');
      }
      if (existingSkus.has(row.input.sku))
        row.errors.push('SKU already exists; import only creates new products');
      for (const code of row.input.barcodes)
        if (existingCodes.has(code))
          row.errors.push(`Barcode already exists: ${code}`);
    }
    return rows;
  }

  async preview(value: unknown) {
    const csv = csvText(objectInput(value).csv);
    try {
      const rows = await this.prepare(this.database.connectionPool, csv);
      return {
        canImport: rows.every((row) => !row.errors.length),
        rows: rows.map((row) => ({
          row: row.row,
          sku: row.input?.sku ?? row.sku,
          name: row.input?.name ?? row.name,
          categoryName: row.categoryName,
          unit: row.input?.unit ?? null,
          priceMinor: row.input?.priceMinor ?? null,
          errors: row.errors,
        })),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ServiceUnavailableException(
        'Import preview is unavailable. Please retry.',
      );
    }
  }

  import(actor: CatalogueActor, value: unknown) {
    const csv = csvText(objectInput(value).csv),
      command = commandInput(value);
    return this.writes.execute(
      actor,
      command,
      { action: 'products.import', csv, reason: command.reason },
      async (client) => {
        const rows = await this.prepare(client, csv);
        if (rows.some((row) => row.errors.length))
          throw new BadRequestException(
            'The file no longer passes validation. Preview it again before importing.',
          );
        const ids: string[] = [];
        for (const row of rows) {
          if (!row.input) throw new BadRequestException('Invalid import row');
          const product = await insertProduct(
            client,
            actor,
            command.reason,
            row.input,
          );
          ids.push(product.id);
        }
        return { imported: ids.length, productIds: ids };
      },
    );
  }
}
