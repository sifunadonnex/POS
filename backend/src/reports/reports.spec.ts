import { Test } from '@nestjs/testing';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { DatabaseService } from '../database/database.service.js';
import { ReportsService } from './reports.service.js';

const config: AppConfig = {
  nodeEnv: 'test',
  port: 3000,
  databaseUrl: 'postgresql://test:fake@localhost/test',
  databaseTls: false,
  databasePoolMax: 5,
  runtime: { mode: 'hosted', storeId: null },
  daraja: null,
  sync: null,
  bootstrap: null,
};
const storeId = '11111111-1111-4111-8111-111111111111';
const syncConfig: AppConfig = {
  ...config,
  sync: {
    storeId,
    secret: 's'.repeat(32),
    targetUrl: null,
    pollSeconds: 10,
  },
};

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
        { provide: APP_CONFIG, useValue: config },
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
    const query = vi.fn(async (sql: string, _params?: unknown[]) => {
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
        { provide: APP_CONFIG, useValue: config },
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
      if (sql.includes('p.low_stock_threshold_minor IS NOT NULL')) {
        return {
          rows: [
            {
              product_id: 'product-1',
              sku: 'RICE',
              product_name: 'Loose rice',
              unit: 'kg',
              quantity_minor: '1250',
              threshold_minor: '2000',
              low_stock_count: 2,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: APP_CONFIG, useValue: config },
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
    expect(result.lowStockItems).toEqual([
      {
        productId: 'product-1',
        sku: 'RICE',
        name: 'Loose rice',
        unit: 'kg',
        quantityMinor: 1250,
        thresholdMinor: 2000,
      },
    ]);
  });

  it('returns daily, cashier, payment and product sales insights', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('COUNT(DISTINCT actor_id)')) {
        return {
          rows: [
            {
              sale_count: '4',
              gross_sales_minor: '26000',
              refund_count: '1',
              refund_minor: '2000',
              active_cashier_count: '2',
            },
          ],
        };
      }
      if (sql.includes('generate_series')) {
        return {
          rows: [
            {
              day: '2026-09-27',
              sale_count: 1,
              gross_sales_minor: '6000',
              refund_minor: '0',
            },
            {
              day: '2026-09-28',
              sale_count: 3,
              gross_sales_minor: '20000',
              refund_minor: '2000',
            },
          ],
        };
      }
      if (sql.includes('sales_by_actor')) {
        return {
          rows: [
            {
              cashier_id: 'cashier-1',
              cashier_name: 'Amina Cashier',
              sale_count: 3,
              gross_sales_minor: '20000',
              refund_minor: '2000',
            },
          ],
        };
      }
      if (sql.includes('FROM sale_payment')) {
        return {
          rows: [
            { kind: 'cash', payment_count: 3, amount_minor: '18000' },
            { kind: 'mpesa', payment_count: 1, amount_minor: '8000' },
          ],
        };
      }
      if (sql.includes('FROM sale_line')) {
        return {
          rows: [
            {
              product_id: 'product-1',
              product_name: 'Premium flour',
              unit: 'each',
              quantity_minor: '4',
              gross_sales_minor: '12000',
              sale_count: 3,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: APP_CONFIG, useValue: config },
        {
          provide: DatabaseService,
          useValue: { connectionPool: { query } },
        },
      ],
    }).compile();

    const result = await module
      .get(ReportsService)
      .salesInsights('2026-09-27', '2026-09-28');

    expect(result.summary).toEqual({
      saleCount: 4,
      grossSalesMinor: 26000,
      refundCount: 1,
      refundMinor: 2000,
      netSalesMinor: 24000,
      averageBasketMinor: 6500,
      activeCashierCount: 2,
    });
    expect(result.daily).toHaveLength(2);
    expect(result.daily[1]).toMatchObject({ netSalesMinor: 18000 });
    expect(result.cashiers[0]).toMatchObject({
      cashierName: 'Amina Cashier',
      netSalesMinor: 18000,
      averageBasketMinor: 6667,
    });
    expect(result.paymentMix).toHaveLength(2);
    expect(result.topProducts[0]).toMatchObject({
      productName: 'Premium flour',
      grossSalesMinor: 12000,
    });
  });

  it('reports one synchronized store separately with projection lag', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('MAX(i.received_at)')) {
        return {
          rows: [
            {
              received_events: 4,
              projected_events: 3,
              latest_received_at: '2026-10-02 12:00:00+00',
            },
          ],
        };
      }
      if (sql.includes('COUNT(DISTINCT cashier_id)')) {
        return {
          rows: [
            {
              sale_count: 3,
              gross_sales_minor: '18000',
              refund_count: 0,
              refund_minor: 0,
              active_cashier_count: 1,
            },
          ],
        };
      }
      if (sql.includes('COUNT(DISTINCT actor_id)')) {
        return {
          rows: [
            {
              sale_count: 2,
              gross_sales_minor: '10000',
              refund_count: 1,
              refund_minor: '1000',
              active_cashier_count: 1,
            },
          ],
        };
      }
      if (sql.includes('generate_series')) {
        if (!sql.includes('sync_cash_sale_projection')) {
          return {
            rows: [
              {
                day: '2026-10-02',
                sale_count: 2,
                gross_sales_minor: '10000',
                refund_minor: '1000',
              },
            ],
          };
        }
        return {
          rows: [
            {
              day: '2026-10-02',
              sale_count: 3,
              gross_sales_minor: '18000',
              refund_minor: 0,
            },
          ],
        };
      }
      if (sql.includes('sales_by_actor')) {
        return {
          rows: [
            {
              cashier_id: 'hosted-cashier',
              cashier_name: 'Hosted Cashier',
              sale_count: 2,
              gross_sales_minor: '10000',
              refund_minor: '1000',
            },
          ],
        };
      }
      if (sql.includes('sale.cashier_id')) {
        return {
          rows: [
            {
              cashier_id: 'edge-cashier',
              cashier_name: 'Edge Cashier',
              sale_count: 3,
              gross_sales_minor: '18000',
              refund_minor: 0,
            },
          ],
        };
      }
      if (sql.includes("'cash'::text")) {
        return {
          rows: [{ kind: 'cash', payment_count: 3, amount_minor: '18000' }],
        };
      }
      if (sql.includes('FROM sale_payment')) {
        return {
          rows: [{ kind: 'cash', payment_count: 2, amount_minor: '10000' }],
        };
      }
      if (sql.includes('sync_cash_sale_line_projection')) {
        return {
          rows: [
            {
              product_id: 'edge-product',
              product_name: 'Edge Product',
              unit: 'each',
              quantity_minor: 3,
              gross_sales_minor: '18000',
              sale_count: 3,
            },
          ],
        };
      }
      if (sql.includes('FROM sale_line')) {
        return {
          rows: [
            {
              product_id: 'hosted-product',
              product_name: 'Hosted Product',
              unit: 'each',
              quantity_minor: 2,
              gross_sales_minor: '10000',
              sale_count: 2,
            },
          ],
        };
      }
      return { rows: [] };
    });
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: APP_CONFIG, useValue: syncConfig },
        {
          provide: DatabaseService,
          useValue: { connectionPool: { query } },
        },
      ],
    }).compile();

    const result = await module
      .get(ReportsService)
      .salesInsights('2026-10-02', '2026-10-02', 'edge', storeId);

    expect(result.scope).toEqual({
      source: 'edge',
      storeId,
      label: 'Synchronized store · 11111111',
    });
    expect(result.summary).toMatchObject({
      saleCount: 3,
      grossSalesMinor: 18000,
      refundMinor: 0,
    });
    expect(result.cashiers[0]).toMatchObject({
      cashierName: 'Edge Cashier',
      source: 'edge',
      storeId,
    });
    expect(result.reportingLag).toMatchObject({
      status: 'lagging',
      receivedEvents: 4,
      projectedEvents: 3,
    });
    expect(result.coverage.synchronizedReturns).toBe('not_available');

    const combined = await module
      .get(ReportsService)
      .salesInsights('2026-10-02', '2026-10-02', 'all');
    expect(combined.summary).toMatchObject({
      saleCount: 5,
      grossSalesMinor: 28000,
      refundMinor: 1000,
      netSalesMinor: 27000,
      activeCashierCount: 2,
    });
    expect(combined.cashiers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ source: 'operational' }),
        expect.objectContaining({ source: 'edge', storeId }),
      ]),
    );
    expect(combined.paymentMix).toEqual([
      { kind: 'cash', paymentCount: 5, amountMinor: 28000 },
    ]);
  });

  it('rejects invalid date input', async () => {
    const module = await Test.createTestingModule({
      providers: [
        ReportsService,
        { provide: APP_CONFIG, useValue: config },
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
    await expect(service.summary('2026-02-31')).rejects.toThrow('YYYY-MM-DD');
    await expect(
      service.salesInsights('2026-09-29', '2026-09-01'),
    ).rejects.toThrow('start date');
    await expect(
      service.salesInsights('2026-01-01', '2026-09-29'),
    ).rejects.toThrow('93 days');
    await expect(
      service.salesInsights('2026-09-01', '2026-09-29', 'edge', storeId),
    ).rejects.toThrow('synchronized store');
  });
});
