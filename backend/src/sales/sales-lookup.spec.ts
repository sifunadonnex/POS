import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { SalesLookupService } from './sales-lookup.service.js';

describe('SalesLookupService', () => {
  it('lists completed sales with payment and refund status', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          saleId: '11111111-1111-4111-8111-111111111111',
          cashierId: 'cashier-1',
          cashierName: 'Test Cashier',
          totalMinor: '1250',
          paidMinor: '1250',
          refundedMinor: '250',
          lineCount: 2,
          paymentKinds: ['cash'],
          createdAt: '2026-09-21T08:00:00.000Z',
        },
      ],
    });
    const module = await Test.createTestingModule({
      providers: [
        SalesLookupService,
        {
          provide: DatabaseService,
          useValue: { connectionPool: { query } },
        },
      ],
    }).compile();

    await expect(
      module
        .get(SalesLookupService)
        .listSales(
          { userId: 'manager-1', role: 'manager' },
          'Test',
          '2026-09-01',
          '2026-09-30',
          0,
        ),
    ).resolves.toEqual({
      sales: [
        expect.objectContaining({
          totalMinor: 1250,
          paidMinor: 1250,
          refundedMinor: 250,
          balanceMinor: 0,
          paymentStatus: 'paid',
        }),
      ],
      hasMore: false,
    });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('line_totals'), [
      'Test',
      '2026-09-01',
      '2026-09-30',
      true,
      'manager-1',
      0,
    ]);
  });

  it('rejects an inverted sales-history range', async () => {
    const module = await Test.createTestingModule({
      providers: [
        SalesLookupService,
        {
          provide: DatabaseService,
          useValue: { connectionPool: { query: vi.fn() } },
        },
      ],
    }).compile();

    await expect(
      module
        .get(SalesLookupService)
        .listSales(
          { userId: 'cashier-1', role: 'cashier' },
          '',
          '2026-09-30',
          '2026-09-01',
          0,
        ),
    ).rejects.toThrow('sales start date');
  });

  it('returns a paid sale receipt with server snapshots', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM sale WHERE')) {
        return {
          rows: [
            {
              saleId: '11111111-1111-4111-8111-111111111111',
              totalMinor: '1250',
              status: 'completed',
              createdAt: '2026-09-21T08:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM sale_line')) {
        return {
          rows: [
            {
              productId: '22222222-2222-4222-8222-222222222222',
              name: 'Rice',
              sku: 'RICE',
              unit: 'each',
              quantityMinor: '1',
              unitPriceMinor: '1250',
              lineTotalMinor: '1250',
            },
          ],
        };
      }
      if (sql.includes('FROM sale_payment')) {
        return {
          rows: [
            {
              paymentId: '33333333-3333-4333-8333-333333333333',
              kind: 'cash',
              amountMinor: '1250',
              paidAt: '2026-09-21T08:00:01.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const module = await Test.createTestingModule({
      providers: [
        SalesLookupService,
        {
          provide: DatabaseService,
          useValue: { connectionPool: { query } },
        },
      ],
    }).compile();

    await expect(
      module
        .get(SalesLookupService)
        .receipt('11111111-1111-4111-8111-111111111111'),
    ).resolves.toMatchObject({
      saleId: '11111111-1111-4111-8111-111111111111',
      totalMinor: 1250,
      lines: [{ quantity: 1, lineTotalMinor: 1250 }],
      payments: [{ kind: 'cash', amountMinor: 1250 }],
    });
  });

  it('does not expose an unpaid sale as a printable receipt', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM sale WHERE')) {
        return {
          rows: [
            {
              saleId: '11111111-1111-4111-8111-111111111111',
              totalMinor: '1250',
              status: 'completed',
              createdAt: '2026-09-21T08:00:00.000Z',
            },
          ],
        };
      }
      if (sql.includes('FROM sale_line')) return { rows: [] };
      if (sql.includes('FROM sale_payment')) return { rows: [] };
      return { rows: [] };
    });
    const module = await Test.createTestingModule({
      providers: [
        SalesLookupService,
        {
          provide: DatabaseService,
          useValue: { connectionPool: { query } },
        },
      ],
    }).compile();

    await expect(
      module
        .get(SalesLookupService)
        .receipt('11111111-1111-4111-8111-111111111111'),
    ).rejects.toThrow('Payment is not complete');
  });
});
