import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { InventoryService } from './inventory.service.js';
import { InventoryWrites } from './inventory-writes.js';

const productOneId = '11111111-1111-4111-8111-111111111111';
const productTwoId = '22222222-2222-4222-8222-222222222222';
const requestOneId = '33333333-3333-4333-8333-333333333333';
const requestTwoId = '44444444-4444-4444-8444-444444444444';
const query = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  query.mockImplementation(async (sql: string) => {
    if (sql.includes('SELECT pg_advisory_xact_lock')) {
      return { rows: [] };
    }
    if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
      return { rowCount: 1, rows: [{ id: 'manager' }] };
    }
    if (sql.includes('SELECT actor_id, fingerprint, response FROM inventory_request')) {
      return { rows: [] };
    }
    if (sql.includes('SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor')) {
      return {
        rows: [
          {
            id: productOneId,
            unit: 'each',
            active: true,
            quantity_minor: 5,
          },
        ],
      };
    }
    if (sql.includes('INSERT INTO inventory_stock')) {
      return { rows: [] };
    }
    if (sql.includes('INSERT INTO inventory_movement')) {
      return { rows: [{ id: 'move-1' }] };
    }
    if (sql.includes('INSERT INTO inventory_request')) {
      return { rows: [] };
    }
    return { rows: [] };
  });
});

describe('InventoryService', () => {
  it('rejects negative stock adjustments when the batch would go below zero', async () => {
    const module = await Test.createTestingModule({
      providers: [
        InventoryService,
        InventoryWrites,
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

    const service = module.get(InventoryService);

    await expect(
      service.adjust({ userId: 'manager', sessionId: 'session' }, {
        requestId: requestOneId,
        reason: 'Audit fix',
        productId: productOneId,
        quantity: -6,
      }),
    ).rejects.toThrow('Insufficient stock');
  });

  it('converts fractional kg quantities into exact minor-unit quantity values', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor')) {
        return {
          rows: [
            {
              id: productTwoId,
              unit: 'kg',
              active: true,
              quantity_minor: 1000,
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO inventory_movement')) {
        return { rows: [{ id: 'move-2' }] };
      }
      if (sql.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'manager' }] };
      }
      if (sql.includes('SELECT actor_id, fingerprint, response FROM inventory_request')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO inventory_stock')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO inventory_request')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        InventoryService,
        InventoryWrites,
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

    const service = module.get(InventoryService);

    const result = await service.adjust({ userId: 'manager', sessionId: 'session' }, {
      requestId: requestTwoId,
      reason: 'Stock count',
      productId: productTwoId,
      quantity: 1.25,
    });

    expect(result.quantityMinor).toBe(2250);
  });
});
