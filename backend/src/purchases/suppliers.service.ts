import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { type PurchaseActor, PurchasesWrites } from './purchases-writes.js';

export type Supplier = {
  id: string;
  name: string;
  createdAt: string;
};

type LedgerRow = {
  entry_id: string;
  kind: 'receipt' | 'return';
  receipt_id: string;
  amount_minor: string | number;
  reason: string;
  created_at: string;
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

function dateInput(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new BadRequestException(`${field} must be in YYYY-MM-DD format`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${field} must be in YYYY-MM-DD format`);
  }
  return value;
}

function safeInteger(value: string | number): number {
  const result = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(result)) {
    throw new ServiceUnavailableException(
      'Supplier ledger contains an unsafe amount.',
    );
  }
  return result;
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

  async ledger(
    supplierId: unknown,
    fromValue: unknown,
    toValue: unknown,
    pageValue: unknown,
  ) {
    if (
      typeof supplierId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        supplierId.trim(),
      )
    ) {
      throw new BadRequestException('Provide a valid supplier ID');
    }
    const from = dateInput(fromValue, 'Start date');
    const to = dateInput(toValue, 'End date');
    if (from > to) {
      throw new BadRequestException(
        'The ledger start date must be before its end date',
      );
    }
    const page = pageValue === undefined ? 0 : Number(pageValue);
    if (!Number.isInteger(page) || page < 0 || page > 200) {
      throw new BadRequestException('Invalid page');
    }

    try {
      const supplierResult = await this.database.connectionPool.query<Supplier>(
        'SELECT id, name, created_at AS "createdAt" FROM supplier WHERE id = $1',
        [supplierId],
      );
      const supplier = supplierResult.rows[0];
      if (!supplier) throw new NotFoundException('Supplier not found');

      const result = await this.database.connectionPool.query<LedgerRow>(
        `SELECT receipt.id AS entry_id, 'receipt'::text AS kind, receipt.id AS receipt_id,
          receipt.total_minor AS amount_minor, receipt.reason, receipt.created_at
        FROM purchase_receipt receipt
        WHERE receipt.supplier_id = $1 AND receipt.status = 'received'
          AND receipt.created_at >= $2::date AND receipt.created_at < ($3::date + interval '1 day')
        UNION ALL
        SELECT purchase_return.id AS entry_id, 'return'::text AS kind,
          purchase_return.receipt_id, purchase_return.total_minor AS amount_minor,
          purchase_return.reason, purchase_return.created_at
        FROM purchase_return
        JOIN purchase_receipt receipt ON receipt.id = purchase_return.receipt_id
        WHERE receipt.supplier_id = $1 AND purchase_return.status = 'returned'
          AND purchase_return.created_at >= $2::date AND purchase_return.created_at < ($3::date + interval '1 day')
        ORDER BY created_at DESC, entry_id DESC
        LIMIT 51 OFFSET $4`,
        [supplierId, from, to, page * 50],
      );

      const entries = result.rows.slice(0, 50).map((row) => {
        const amountMinor = safeInteger(row.amount_minor);
        return {
          entryId: row.entry_id,
          kind: row.kind,
          receiptId: row.receipt_id,
          amountMinor,
          signedMinor: row.kind === 'receipt' ? amountMinor : -amountMinor,
          reason: row.reason,
          createdAt: row.created_at,
        };
      });

      return {
        supplier,
        from,
        to,
        entries,
        hasMore: result.rows.length > 50,
      };
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof NotFoundException ||
        error instanceof ServiceUnavailableException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Supplier ledger is temporarily unavailable.',
      );
    }
  }
}
