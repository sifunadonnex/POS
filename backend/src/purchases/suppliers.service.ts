import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { type PurchaseActor, PurchasesWrites } from './purchases-writes.js';

export type Supplier = {
  id: string;
  name: string;
  createdAt: string;
};

function objectInput(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requestIdInput(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    throw new BadRequestException('Provide a valid request ID');
  }
  return value.trim();
}

function textInput(
  value: unknown,
  field: string,
  minimum: number,
  maximum: number,
): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`Provide a ${field}`);
  }
  const text = value.trim();
  if (text.length < minimum || text.length > maximum) {
    throw new BadRequestException(
      `${field} must contain between ${minimum} and ${maximum} characters`,
    );
  }
  return text;
}

@Injectable()
export class SuppliersService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
    @Inject(PurchasesWrites) private readonly writes: PurchasesWrites,
  ) {}

  async list(search: unknown, page: unknown) {
    const query =
      search === undefined || search === ''
        ? ''
        : textInput(search, 'search', 1, 160);
    const pageNumber = page === undefined ? 0 : Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 0 || pageNumber > 200) {
      throw new BadRequestException('Invalid page');
    }

    try {
      const result = await this.database.connectionPool.query<Supplier>(
        `SELECT id, name, created_at AS "createdAt"
        FROM supplier
        WHERE ($1 = '' OR strpos(lower(name), lower($1)) > 0)
        ORDER BY lower(name), id LIMIT 51 OFFSET $2`,
        [query, pageNumber * 50],
      );
      return {
        suppliers: result.rows.slice(0, 50),
        hasMore: result.rows.length > 50,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Suppliers are temporarily unavailable.',
      );
    }
  }

  async create(actor: PurchaseActor, value: unknown) {
    const body = objectInput(value);
    const requestId = requestIdInput(body.requestId);
    const name = textInput(body.name, 'supplier name', 2, 200);
    const reason = textInput(body.reason, 'reason', 3, 200);

    return this.writes.execute(
      actor,
      requestId,
      { action: 'supplier.create', name, reason },
      async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(20260921, 4)');
        const existing = await client.query<{ id: string }>(
          'SELECT id FROM supplier WHERE lower(name) = lower($1) FOR SHARE',
          [name],
        );
        if (existing.rowCount) {
          throw new ConflictException(
            'A supplier with this name already exists',
          );
        }
        const result = await client.query<Supplier>(
          `INSERT INTO supplier (id, name) VALUES ($1, $2)
          RETURNING id, name, created_at AS "createdAt"`,
          [randomUUID(), name],
        );
        const supplier = result.rows[0];
        if (!supplier)
          throw new ServiceUnavailableException('Supplier was not created');
        return { supplier };
      },
    );
  }
}
