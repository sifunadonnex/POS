import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';

type ReturnUnit = 'each' | 'pack' | 'kg' | 'l';

export type SaleSummary = {
  saleId: string;
  totalMinor: number;
  refundedMinor: number;
  refundableMinor: number;
  createdAt: string;
};

export type ReturnSale = SaleSummary & {
  lines: Array<{
    productId: string;
    name: string;
    sku: string;
    unit: ReturnUnit;
    soldQuantityMinor: number;
    returnedQuantityMinor: number;
    availableQuantityMinor: number;
    unitPriceMinor: number;
  }>;
};

function uuidInput(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value.trim(),
    )
  ) {
    throw new BadRequestException(`Provide a valid ${field}`);
  }
  return value.trim();
}

function searchInput(value: unknown): string {
  if (value === undefined || value === '') return '';
  if (typeof value !== 'string' || value.trim().length > 80) {
    throw new BadRequestException('Invalid sale search');
  }
  return value.trim();
}

@Injectable()
export class ReturnsLookupService {
  constructor(
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async listSales(search: unknown, page: unknown) {
    const query = searchInput(search);
    const pageNumber = page === undefined ? 0 : Number(page);
    if (!Number.isInteger(pageNumber) || pageNumber < 0 || pageNumber > 200) {
      throw new BadRequestException('Invalid page');
    }
    try {
      const result = await this.database.connectionPool.query<SaleSummary>(
        `SELECT s.id AS "saleId", s.total_minor AS "totalMinor",
        COALESCE(SUM(r.amount_minor) FILTER (WHERE r.status = 'paid'), 0) AS "refundedMinor",
        s.created_at AS "createdAt"
        FROM sale s LEFT JOIN sale_refund r ON r.sale_id = s.id
        WHERE s.status = 'completed'
          AND ($1 = '' OR s.id::text = $1)
        GROUP BY s.id ORDER BY s.created_at DESC LIMIT 21 OFFSET $2`,
        [query, pageNumber * 20],
      );
      return {
        sales: result.rows
          .map((row) => {
            const totalMinor = Number(row.totalMinor);
            const refundedMinor = Number(row.refundedMinor);
            return {
              saleId: row.saleId,
              totalMinor,
              refundedMinor,
              refundableMinor: totalMinor - refundedMinor,
              createdAt: row.createdAt,
            };
          })
          .slice(0, 20),
        hasMore: result.rows.length > 20,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Completed sales are temporarily unavailable.',
      );
    }
  }

  async sale(saleIdValue: string) {
    const saleId = uuidInput(saleIdValue, 'sale ID');
    try {
      const saleResult = await this.database.connectionPool.query<
        SaleSummary & { status: string }
      >(
        `SELECT s.id AS "saleId", s.total_minor AS "totalMinor", s.status,
        COALESCE(SUM(r.amount_minor) FILTER (WHERE r.status = 'paid'), 0) AS "refundedMinor",
        s.created_at AS "createdAt"
        FROM sale s LEFT JOIN sale_refund r ON r.sale_id = s.id
        WHERE s.id = $1 GROUP BY s.id`,
        [saleId],
      );
      const source = saleResult.rows[0];
      if (!source || source.status !== 'completed') {
        throw new NotFoundException('Completed sale not found');
      }
      const lines = await this.database.connectionPool.query<{
        productId: string;
        name: string;
        sku: string;
        unit: ReturnUnit;
        soldQuantityMinor: number;
        returnedQuantityMinor: string;
        unitPriceMinor: number;
      }>(
        `SELECT sl.product_id AS "productId", p.name, p.sku, p.unit,
        sl.quantity_minor AS "soldQuantityMinor", sl.unit_price_minor AS "unitPriceMinor",
        COALESCE(SUM(srl.quantity_minor) FILTER (WHERE sr.status IN ('requested', 'approved', 'completed')), 0)::text AS "returnedQuantityMinor"
        FROM sale_line sl JOIN catalogue_product p ON p.id = sl.product_id
        LEFT JOIN sale_return_line srl ON srl.sale_line_id = sl.id
        LEFT JOIN sale_return sr ON sr.id = srl.return_id
        WHERE sl.sale_id = $1 GROUP BY sl.id, p.id ORDER BY sl.created_at ASC`,
        [saleId],
      );
      const refundedMinor = Number(source.refundedMinor);
      return {
        saleId: source.saleId,
        totalMinor: Number(source.totalMinor),
        refundedMinor,
        refundableMinor: Number(source.totalMinor) - refundedMinor,
        createdAt: source.createdAt,
        lines: lines.rows.map((line) => {
          const sold = Number(line.soldQuantityMinor);
          const returned = Number(line.returnedQuantityMinor);
          return {
            ...line,
            soldQuantityMinor: sold,
            returnedQuantityMinor: returned,
            availableQuantityMinor: sold - returned,
            unitPriceMinor: Number(line.unitPriceMinor),
          };
        }),
      } satisfies ReturnSale;
    } catch (error) {
      if (
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        throw error;
      }
      throw new ServiceUnavailableException(
        'Sale details are temporarily unavailable.',
      );
    }
  }
}
