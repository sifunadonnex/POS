import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { StocktakeService } from './stocktake.service.js';
import { StocktakeWrites } from './stocktake-writes.js';

describe('StocktakeService', () => {
  it('records a counted quantity and reconciles stock to the count', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'manager' }] };
      }
      if (sql.includes('SELECT actor_id, fingerprint, response FROM stocktake_request')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor')) {
        return {
          rows: [{ id: 'product-1', unit: 'each', active: true, quantity_minor: 5 }],
        };
      }
      if (sql.includes('INSERT INTO stocktake')) {
        return { rows: [{ id: 'count-1' }] };
      }
      if (sql.includes('INSERT INTO inventory_stock')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO inventory_movement')) {
        return { rows: [{ id: 'move-1' }] };
      }
      if (sql.includes('INSERT INTO stocktake_request')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        StocktakeService,
        StocktakeWrites,
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

    const service = module.get(StocktakeService);
    const result = await service.count({ userId: 'manager', sessionId: 'session' }, {
      requestId: '33333333-3333-4333-8333-333333333333',
      productId: 'product-1',
      quantity: 8,
      reason: 'Physical count',
    });

    expect(result.productId).toBe('product-1');
    expect(result.quantityMinor).toBe(8);
    expect(result.deltaMinor).toBe(3);
  });
});
