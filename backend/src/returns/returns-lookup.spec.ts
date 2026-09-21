import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { ReturnsLookupService } from './returns-lookup.service.js';

const saleId = '11111111-1111-4111-8111-111111111111';

it('returns recent completed sales with refundable totals', async () => {
  const query = vi.fn(async () => ({
    rows: [
      {
        saleId,
        totalMinor: 2500,
        refundedMinor: 500,
        createdAt: '2026-09-21T09:00:00.000Z',
      },
    ],
  }));
  const module = await Test.createTestingModule({
    providers: [
      ReturnsLookupService,
      { provide: DatabaseService, useValue: { connectionPool: { query } } },
    ],
  }).compile();

  await expect(
    module.get(ReturnsLookupService).listSales('', 0),
  ).resolves.toEqual({
    sales: [expect.objectContaining({ saleId, refundableMinor: 2000 })],
    hasMore: false,
  });
});

it('returns sale lines with quantities still available for return', async () => {
  const query = vi.fn(async (sql: string) => {
    if (sql.includes('FROM sale s LEFT JOIN sale_refund')) {
      return {
        rows: [
          {
            saleId,
            totalMinor: 2500,
            refundedMinor: 500,
            status: 'completed',
            createdAt: '2026-09-21T09:00:00.000Z',
          },
        ],
      };
    }
    return {
      rows: [
        {
          productId: '22222222-2222-4222-8222-222222222222',
          name: 'Loose rice',
          sku: 'RICE',
          unit: 'kg',
          soldQuantityMinor: 1250,
          returnedQuantityMinor: '250',
          unitPriceMinor: 2000,
        },
      ],
    };
  });
  const module = await Test.createTestingModule({
    providers: [
      ReturnsLookupService,
      { provide: DatabaseService, useValue: { connectionPool: { query } } },
    ],
  }).compile();

  await expect(module.get(ReturnsLookupService).sale(saleId)).resolves.toEqual(
    expect.objectContaining({
      saleId,
      lines: [expect.objectContaining({ availableQuantityMinor: 1000 })],
    }),
  );
});
