import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { SalesService } from './sales.service.js';
import { SalesWrites } from './sales-writes.js';

describe('SalesService', () => {
  it('calculates exact totals for integer and fractional quantities', () => {
    const service = new SalesService();

    const quote = service.quoteBasket([
      {
        productId: '11111111-1111-4111-8111-111111111111',
        unit: 'each',
        quantity: 2,
        priceMinor: 2500,
      },
      {
        productId: '22222222-2222-4222-8222-222222222222',
        unit: 'kg',
        quantity: 1.75,
        priceMinor: 3200,
      },
      {
        productId: '33333333-3333-4333-8333-333333333333',
        unit: 'l',
        quantity: 0.5,
        priceMinor: 4200,
      },
    ]);

    expect(quote.subtotalMinor).toBe(2500 * 2 + 3200 * 1.75 + 4200 * 0.5);
    expect(quote.totalMinor).toBe(quote.subtotalMinor);
    expect(quote.lines).toHaveLength(3);
    expect(quote.lines[0].lineTotalMinor).toBe(5000);
    expect(quote.lines[1].lineTotalMinor).toBe(5600);
    expect(quote.lines[2].lineTotalMinor).toBe(2100);
  });

  it('rejects invalid fractional quantities for whole-unit products', () => {
    const service = new SalesService();

    expect(() =>
      service.quoteBasket([
        {
          productId: '44444444-4444-4444-8444-444444444444',
          unit: 'pack',
          quantity: 1.5,
          priceMinor: 1000,
        },
      ]),
    ).toThrow('whole number');
  });

  it('rejects quantities below the allowed step for kg and l products', () => {
    const service = new SalesService();

    expect(() =>
      service.quoteBasket([
        {
          productId: '55555555-5555-4555-8555-555555555555',
          unit: 'kg',
          quantity: 0.0009,
          priceMinor: 2000,
        },
      ]),
    ).toThrow('0.001');
  });

  it('finalizes a sale and decrements stock once per request id', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'cashier' }] };
      }
      if (
        sql.includes('SELECT actor_id, fingerprint, response FROM sale_request')
      ) {
        return { rows: [] };
      }
      if (sql.includes('SELECT p.id, p.unit, p.price_minor::text, p.active')) {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              unit: 'kg',
              price_minor: '3200',
              active: true,
              quantity_minor: '2000',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO sale')) {
        return { rows: [{ id: 'sale-1' }] };
      }
      if (sql.includes('INSERT INTO sale_line')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO inventory_movement')) {
        return { rows: [{ id: 'move-1' }] };
      }
      if (sql.includes('UPDATE inventory_stock')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO sale_request')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        SalesService,
        SalesWrites,
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

    const service = module.get(SalesService);
    const result = await service.finalize(
      { userId: 'cashier', sessionId: 'session' },
      {
        requestId: '11111111-1111-4111-8111-111111111111',
        reason: 'Checkout',
        lines: [
          {
            productId: '11111111-1111-4111-8111-111111111111',
            unit: 'kg',
            quantity: 1.25,
            priceMinor: 999999,
          },
        ],
      },
    );

    expect(result.totalMinor).toBe(4000);
    expect(result.saleId).toBe('sale-1');
  });

  it('checks out tendered cash atomically and records the change movement', async () => {
    const cashMovements: unknown[][] = [];
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'cashier' }] };
      }
      if (sql.includes('FROM sale_request WHERE id = $1')) return { rows: [] };
      if (sql.includes('FROM cash_shift')) {
        return { rowCount: 1, rows: [{ id: 'shift-1' }] };
      }
      if (sql.includes('SELECT p.id, p.unit, p.price_minor::text, p.active')) {
        return {
          rows: [
            {
              id: '11111111-1111-4111-8111-111111111111',
              unit: 'each',
              price_minor: '1250',
              active: true,
              quantity_minor: '4',
            },
          ],
        };
      }
      if (sql.includes('INSERT INTO sale_payment')) {
        return { rows: [{ id: 'payment-1' }] };
      }
      if (sql.includes('INSERT INTO cash_movement')) {
        cashMovements.push([sql, ...(params ?? [])]);
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO sale')) return { rows: [{ id: 'sale-1' }] };
      return { rows: [] };
    });
    const module = await Test.createTestingModule({
      providers: [
        SalesService,
        SalesWrites,
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

    await expect(
      module.get(SalesService).checkout(
        { userId: 'cashier', sessionId: 'session' },
        {
          requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          reason: 'Cash checkout',
          cashTenderedMinor: 2000,
          lines: [
            {
              productId: '11111111-1111-4111-8111-111111111111',
              unit: 'each',
              quantity: 1,
            },
          ],
        },
      ),
    ).resolves.toMatchObject({
      saleId: 'sale-1',
      totalMinor: 1250,
      payment: {
        paymentId: 'payment-1',
        shiftId: 'shift-1',
        amountMinor: 1250,
        tenderedMinor: 2000,
        changeMinor: 750,
      },
    });
    expect(cashMovements).toHaveLength(2);
    expect(cashMovements[0]).toContain(2000);
    expect(cashMovements[1]).toContain(750);
  });

  it('records a payment against a sale once per request id', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'cashier' }] };
      }
      if (
        sql.includes(
          'SELECT actor_id, fingerprint, response FROM sale_payment_request',
        )
      ) {
        return { rows: [] };
      }
      if (sql.includes('SELECT total_minor')) {
        return {
          rowCount: 1,
          rows: [{ total_minor: 4000, status: 'completed' }],
        };
      }
      if (sql.includes('FROM cash_shift')) {
        return { rowCount: 1, rows: [{ id: 'shift-1' }] };
      }
      if (sql.includes('INSERT INTO sale_payment')) {
        return { rows: [{ id: 'pay-1' }] };
      }
      if (sql.includes('INSERT INTO cash_movement')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO sale_payment_request')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        SalesService,
        SalesWrites,
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

    const service = module.get(SalesService);
    const result = await service.recordPayment(
      { userId: 'cashier', sessionId: 'session' },
      {
        requestId: '22222222-2222-4222-8222-222222222222',
        saleId: 'sale-1',
        kind: 'cash',
        amountMinor: 4000,
        reason: 'Cash payment',
      },
    );

    expect(result.amountMinor).toBe(4000);
    expect(result.paymentId).toBe('pay-1');
    expect(result.shiftId).toBe('shift-1');
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('FROM sale_payment_request'),
      ),
    ).toBe(true);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('INSERT INTO sale_payment_request'),
      ),
    ).toBe(true);
    expect(
      query.mock.calls.some(([sql]) =>
        sql.includes('INSERT INTO cash_movement'),
      ),
    ).toBe(true);
  });

  it('rejects split payments that exceed the sale total', async () => {
    let paidMinor = 0;
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'cashier' }] };
      }
      if (
        sql.includes(
          'SELECT actor_id, fingerprint, response FROM sale_payment_request',
        )
      ) {
        return { rows: [] };
      }
      if (sql.includes('SELECT total_minor, status FROM sale')) {
        return {
          rowCount: 1,
          rows: [{ total_minor: 4000, status: 'completed' }],
        };
      }
      if (sql.includes('COALESCE(SUM(amount_minor)')) {
        return { rows: [{ paid_minor: String(paidMinor) }] };
      }
      if (sql.includes('FROM cash_shift')) {
        return { rowCount: 1, rows: [{ id: 'shift-1' }] };
      }
      if (sql.includes('INSERT INTO sale_payment_request')) return { rows: [] };
      if (sql.includes('INSERT INTO sale_payment (')) {
        paidMinor += Number((params ?? [])[4]);
        return { rows: [{ id: `pay-${paidMinor}` }] };
      }
      if (sql.includes('INSERT INTO cash_movement')) return { rows: [] };
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        SalesService,
        SalesWrites,
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

    const service = module.get(SalesService);
    await service.recordPayment(
      { userId: 'cashier', sessionId: 'session' },
      {
        requestId: '33333333-3333-4333-8333-333333333333',
        saleId: 'sale-1',
        kind: 'cash',
        amountMinor: 3000,
        reason: 'Part payment',
      },
    );
    await expect(
      service.recordPayment(
        { userId: 'cashier', sessionId: 'session' },
        {
          requestId: '44444444-4444-4444-8444-444444444444',
          saleId: 'sale-1',
          kind: 'cash',
          amountMinor: 2000,
          reason: 'Excess payment',
        },
      ),
    ).rejects.toThrow('Payment exceeds sale total');
  });

  it('requires an open shift before recording a payment', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) return { rows: [] };
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'cashier' }] };
      }
      if (
        sql.includes(
          'SELECT actor_id, fingerprint, response FROM sale_payment_request',
        )
      ) {
        return { rows: [] };
      }
      if (sql.includes('SELECT total_minor, status FROM sale')) {
        return {
          rowCount: 1,
          rows: [{ total_minor: 4000, status: 'completed' }],
        };
      }
      if (sql.includes('COALESCE(SUM(amount_minor)')) {
        return { rows: [{ paid_minor: '0' }] };
      }
      if (sql.includes('FROM cash_shift')) return { rowCount: 0, rows: [] };
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        SalesService,
        SalesWrites,
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

    await expect(
      module.get(SalesService).recordPayment(
        { userId: 'cashier', sessionId: 'session' },
        {
          requestId: '55555555-5555-4555-8555-555555555555',
          saleId: 'sale-1',
          kind: 'cash',
          amountMinor: 4000,
          reason: 'Cash payment',
        },
      ),
    ).rejects.toThrow('Open a register shift');
  });
});
