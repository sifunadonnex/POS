import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { PurchasesWrites } from './purchases-writes.js';
import { SuppliersService } from './suppliers.service.js';

const requestId = '66666666-6666-4666-8666-666666666666';

it('lists suppliers for the purchase intake directory', async () => {
  const query = vi.fn(async () => ({
    rows: [
      {
        id: 'supplier-1',
        name: 'Alpha Foods',
        createdAt: '2026-09-21T08:00:00.000Z',
      },
    ],
  }));
  const module = await Test.createTestingModule({
    providers: [
      SuppliersService,
      PurchasesWrites,
      {
        provide: DatabaseService,
        useValue: { connectionPool: { query } },
      },
    ],
  }).compile();

  await expect(module.get(SuppliersService).list('', 0)).resolves.toEqual({
    suppliers: [expect.objectContaining({ name: 'Alpha Foods' })],
    hasMore: false,
  });
  expect(query).toHaveBeenCalledWith(expect.stringContaining('FROM supplier'), [
    '',
    0,
  ]);
});

it('creates a supplier through the replay-safe purchase writer', async () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('SELECT pg_advisory_xact_lock')) return { rows: [] };
    if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
      return { rowCount: 1, rows: [{ id: 'manager' }] };
    }
    if (
      sql.includes(
        'SELECT actor_id, fingerprint, response FROM purchase_request',
      )
    ) {
      return { rows: [] };
    }
    if (sql.includes('SELECT id FROM supplier'))
      return { rowCount: 0, rows: [] };
    if (sql.includes('INSERT INTO supplier')) {
      return {
        rows: [
          {
            id: 'supplier-2',
            name: 'Beta Wholesale',
            createdAt: '2026-09-21T08:00:00.000Z',
          },
        ],
      };
    }
    if (sql.includes('INSERT INTO purchase_request')) return { rows: [] };
    return { rows: [] };
  });
  const module = await Test.createTestingModule({
    providers: [
      SuppliersService,
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

  const result = await module
    .get(SuppliersService)
    .create(
      { userId: 'manager', sessionId: 'session' },
      { requestId, name: 'Beta Wholesale', reason: 'New supplier' },
    );

  expect(result.supplier.name).toBe('Beta Wholesale');
  expect(query).toHaveBeenCalledWith(
    expect.stringContaining('INSERT INTO supplier'),
    [expect.any(String), 'Beta Wholesale'],
  );
});

it('returns signed supplier ledger entries for the selected date range', async () => {
  const query = vi
    .fn()
    .mockResolvedValueOnce({
      rows: [
        {
          id: 'supplier-1',
          name: 'Alpha Foods',
          createdAt: '2026-09-21T08:00:00.000Z',
        },
      ],
    })
    .mockResolvedValueOnce({
      rows: [
        {
          entry_id: 'receipt-1',
          kind: 'receipt',
          receipt_id: 'receipt-1',
          amount_minor: '20000',
          reason: 'Delivery note 1042',
          created_at: '2026-09-21T08:00:00.000Z',
        },
        {
          entry_id: 'return-1',
          kind: 'return',
          receipt_id: 'receipt-1',
          amount_minor: '5000',
          reason: 'Damaged goods',
          created_at: '2026-09-21T09:00:00.000Z',
        },
      ],
    });
  const module = await Test.createTestingModule({
    providers: [
      SuppliersService,
      PurchasesWrites,
      {
        provide: DatabaseService,
        useValue: { connectionPool: { query } },
      },
    ],
  }).compile();

  const result = await module
    .get(SuppliersService)
    .ledger(
      '11111111-1111-4111-8111-111111111111',
      '2026-09-01',
      '2026-09-21',
      0,
    );

  expect(result.supplier.name).toBe('Alpha Foods');
  expect(result.entries.map((entry) => entry.signedMinor)).toEqual([
    20000, -5000,
  ]);
  expect(result.hasMore).toBe(false);
});
