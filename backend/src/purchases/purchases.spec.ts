import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { PurchasesService } from './purchases.service.js';
import { PurchasesWrites } from './purchases-writes.js';

describe('PurchasesService', () => {
  it('records a supplier receipt and increases stock', async () => {
    const inventoryKinds: string[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'manager' }] };
      }
      if (sql.includes('SELECT actor_id, fingerprint, response FROM purchase_request')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT id, name FROM supplier WHERE id = $1 FOR UPDATE')) {
        return { rowCount: 1, rows: [{ id: 'supplier-1', name: 'Alpha Foods' }] };
      }
      if (sql.includes('INSERT INTO purchase_receipt')) {
        return { rows: [{ id: 'receipt-1' }] };
      }
      if (sql.includes('INSERT INTO purchase_receipt_line')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor')) {
        return {
          rows: [{ id: 'product-1', unit: 'kg', active: true, quantity_minor: 1000 }],
        };
      }
      if (sql.includes('INSERT INTO inventory_stock')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO inventory_movement')) {
        inventoryKinds.push(String((params ?? [])[2] ?? ''));
        return { rows: [{ id: 'move-1' }] };
      }
      if (sql.includes('INSERT INTO purchase_request')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        PurchasesService,
        PurchasesWrites,
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

    const service = module.get(PurchasesService);
    const result = await service.receive({ userId: 'manager', sessionId: 'session' }, {
      requestId: '44444444-4444-4444-8444-444444444444',
      supplierId: 'supplier-1',
      reason: 'Stock replenishment',
      lines: [{ productId: 'product-1', quantity: 1.25, unitCostMinor: 1600 }],
    });

    expect(result.receiptId).toBe('receipt-1');
    expect(result.totalMinor).toBe(2000);
    expect(inventoryKinds).toContain('receive');
  });

  it('records a supplier return and decreases stock', async () => {
    const inventoryKinds: string[] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'manager' }] };
      }
      if (sql.includes('SELECT actor_id, fingerprint, response FROM purchase_request')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT id, supplier_id, total_minor, status FROM purchase_receipt')) {
        return { rowCount: 1, rows: [{ id: 'receipt-1', supplier_id: 'supplier-1', total_minor: 1600, status: 'received' }] };
      }
      if (sql.includes('FROM purchase_receipt_line')) {
        return { rowCount: 1, rows: [{ id: 'line-1', receipt_id: 'receipt-1', product_id: 'product-1', quantity_minor: 1250, unit_cost_minor: 1600 }] };
      }
      if (sql.includes('INSERT INTO purchase_return')) {
        return { rows: [{ id: 'return-1' }] };
      }
      if (sql.includes('SELECT p.id, p.unit, p.active, COALESCE(s.quantity_minor, 0) AS quantity_minor')) {
        return { rows: [{ id: 'product-1', unit: 'kg', active: true, quantity_minor: 1000 }] };
      }
      if (sql.includes('INSERT INTO purchase_return_line')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO inventory_stock')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO inventory_movement')) {
        inventoryKinds.push(String((params ?? [])[2] ?? ''));
        return { rows: [{ id: 'move-1' }] };
      }
      if (sql.includes('INSERT INTO purchase_request')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        PurchasesService,
        PurchasesWrites,
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

    const service = module.get(PurchasesService);
    const result = await service.returnReceipt({ userId: 'manager', sessionId: 'session' }, {
      requestId: '55555555-5555-4555-8555-555555555555',
      receiptId: 'receipt-1',
      reason: 'Damaged goods',
      lines: [{ productId: 'product-1', quantityMinor: 250 }],
    });

    expect(result.returnId).toBe('return-1');
    expect(result.totalMinor).toBe(400);
    expect(inventoryKinds).toContain('return');
  });
});
