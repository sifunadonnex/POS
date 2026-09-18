import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { ReturnsService } from './returns.service.js';
import { ReturnsWrites } from './returns-writes.js';

describe('ReturnsService', () => {
  it('creates a refund and restores stock for a completed sale line', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'manager' }] };
      }
      if (sql.includes('SELECT actor_id, fingerprint, response FROM sale_return_request')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT id, total_minor FROM sale WHERE id = $1 FOR UPDATE')) {
        return { rowCount: 1, rows: [{ id: 'sale-1', total_minor: 3200 }] };
      }
      if (sql.includes('SELECT s.id, s.sale_id, s.status, sl.product_id, sl.quantity_minor, sl.unit_price_minor')) {
        return {
          rowCount: 1,
          rows: [{
            id: 'sale-line-1',
            sale_id: 'sale-1',
            status: 'completed',
            product_id: 'product-1',
            quantity_minor: 2000,
            unit_price_minor: 3200,
          }],
        };
      }
      if (sql.includes('SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor')) {
        return {
          rows: [{ id: 'product-1', unit: 'kg', active: true, quantity_minor: 1000 }],
        };
      }
      if (sql.includes('INSERT INTO sale_return')) {
        return { rows: [{ id: 'return-1' }] };
      }
      if (sql.includes('INSERT INTO sale_return_line')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO sale_refund')) {
        return { rows: [{ id: 'refund-1' }] };
      }
      if (sql.includes('INSERT INTO inventory_stock')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO inventory_movement')) {
        return { rows: [{ id: 'move-1' }] };
      }
      if (sql.includes('INSERT INTO sale_return_request')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        ReturnsService,
        ReturnsWrites,
        {
          provide: DatabaseService,
          useValue: {
            connectionPool: {
              query,
              connect: async () => ({ query, release: vi.fn() }),
            },
          },
        },
      ],
    }).compile();

    const service = module.get(ReturnsService);
    const result = await service.createReturn({ userId: 'manager', sessionId: 'session' }, {
      requestId: '44444444-4444-4444-8444-444444444444',
      saleId: 'sale-1',
      reason: 'Customer return',
      lines: [{ productId: 'product-1', quantityMinor: 500, unitPriceMinor: 3200 }],
    });

    expect(result.returnId).toBe('return-1');
    expect(result.amountMinor).toBe(1600);
    expect(result.refundId).toBe('refund-1');
  });
});
