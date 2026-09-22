import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { ReportsService } from './reports.service.js';

describe('ReportsService', () => {
  it('reconciles purchase receipts and supplier returns for a date range', async () => {
    const query = vi.fn(async () => {
      const call = query.mock.calls.length;
      if (call === 3) {
        return {
          rows: [
            {
              receipt_id: 'receipt-1',
              supplier_id: 'supplier-1',
              supplier_name: 'Alpha Foods',
              total_minor: '20000',
              returned_total_minor: '5000',
              reason: 'Delivery note 1042',
              created_at: '2026-09-21T08:00:00.000Z',
              line_count: 2,
            },
          ],
        };
      }
      if (call === 2) {
        return {
          rows: [
            {
              supplier_id: 'supplier-1',
              supplier_name: 'Alpha Foods',
              receipt_count: 2,
              received_total_minor: '30000',
              return_count: 1,
              returned_total_minor: '5000',
              last_receipt_at: '2026-09-21T08:00:00.000Z',
            },
          ],
        };
      }
      if (call === 1) {
        return {
          rows: [
            {
              receipt_count: 3,
              received_total_minor: '45000',
              return_count: 1,
              returned_total_minor: '5000',
              supplier_count: 2,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: DatabaseService,
          useValue: { connectionPool: { query } },
        },
      ],
    }).compile();

    const result = await module
      .get(ReportsService)
      .purchaseReconciliation('2026-09-01', '2026-09-21');

    expect(result.summary).toEqual({
      receiptCount: 3,
      receivedTotalMinor: 45000,
      returnCount: 1,
      returnedTotalMinor: 5000,
      netPurchasesMinor: 40000,
      supplierCount: 2,
    });
    expect(result.suppliers[0]?.netPurchasesMinor).toBe(25000);
    expect(result.receipts[0]?.netTotalMinor).toBe(15000);
  });

  it('returns aggregate sales and cash summary for a day', async () => {
    const query = vi.fn(async (sql: string, params?: unknown[]) => {
      if (sql.includes('sale_payment') && sql.includes('kind')) {
        return {
          rows: [
            {
              cash_minor: 9000,
              card_minor: 4000,
              mpesa_minor: 2000,
              payment_count: 3,
            },
          ],
        };
      }
      if (sql.includes('sale_refund') && sql.includes('SUM')) {
        return {
          rows: [{ refund_minor: 1500, refund_count: 1 }],
        };
      }
      if (sql.includes('cash_shift') && sql.includes('variance_minor')) {
        return {
          rows: [{ closed_shift_count: 2, variance_minor: 250 }],
        };
      }
      if (sql.includes('FROM sale')) {
        return {
          rows: [{ sale_count: 3, sales_total_minor: 15000 }],
        };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: DatabaseService,
          useValue: {
            connectionPool: { query },
          },
        },
      ],
    }).compile();

    const service = module.get(ReportsService);
    const result = await service.summary('2026-09-18');

    expect(result.saleCount).toBe(3);
    expect(result.salesTotalMinor).toBe(15000);
    expect(result.cashMinor).toBe(9000);
    expect(result.refundMinor).toBe(1500);
    expect(result.varianceMinor).toBe(250);
  });

  it('includes low-stock counts in the summary', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM sale')) {
        return { rows: [{ sale_count: 2, sales_total_minor: 12000 }] };
      }
      if (sql.includes('sale_payment') && sql.includes('kind')) {
        return {
          rows: [
            {
              cash_minor: 7000,
              card_minor: 3000,
              mpesa_minor: 2000,
              payment_count: 3,
            },
          ],
        };
      }
      if (sql.includes('sale_refund') && sql.includes('SUM')) {
        return { rows: [{ refund_minor: 500, refund_count: 1 }] };
      }
      if (sql.includes('cash_shift') && sql.includes('variance_minor')) {
        return { rows: [{ closed_shift_count: 1, variance_minor: 100 }] };
      }
      if (sql.includes('FROM inventory_stock')) {
        return { rows: [{ low_stock_count: 2 }] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: DatabaseService,
          useValue: {
            connectionPool: { query },
          },
        },
      ],
    }).compile();

    const service = module.get(ReportsService);
    const result = await service.summary('2026-09-18');

    expect(result.lowStockCount).toBe(2);
  });

  it('rejects invalid date input', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        {
          provide: DatabaseService,
          useValue: {
            connectionPool: { query: vi.fn() },
          },
        },
      ],
    }).compile();

    const service = module.get(ReportsService);
    await expect(service.summary('bad-date')).rejects.toThrow('YYYY-MM-DD');
  });
});
