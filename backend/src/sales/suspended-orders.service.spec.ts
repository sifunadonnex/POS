import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { SalesWrites } from './sales-writes.js';
import { SuspendedOrdersService } from './suspended-orders.service.js';

describe('SuspendedOrdersService', () => {
  it('server-scopes cashier lists to their owner id', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const module = await Test.createTestingModule({
      providers: [
        SuspendedOrdersService,
        { provide: DatabaseService, useValue: { connectionPool: { query } } },
        { provide: SalesWrites, useValue: {} },
      ],
    }).compile();

    await expect(
      module.get(SuspendedOrdersService).list({
        userId: 'cashier-1',
        sessionId: 'session-1',
        role: 'cashier',
      }),
    ).resolves.toEqual({ orders: [] });
    expect(query).toHaveBeenCalledWith(expect.stringContaining('so.owner_id'), [
      null,
      true,
      false,
      'cashier-1',
    ]);
  });

  it('rejects invalid fractional whole-item quantities before writing', async () => {
    const executeSuspendedOrder = vi.fn();
    const module = await Test.createTestingModule({
      providers: [
        SuspendedOrdersService,
        {
          provide: DatabaseService,
          useValue: { connectionPool: { query: vi.fn() } },
        },
        { provide: SalesWrites, useValue: { executeSuspendedOrder } },
      ],
    }).compile();

    await expect(
      module.get(SuspendedOrdersService).create(
        {
          userId: 'cashier-1',
          sessionId: 'session-1',
          role: 'cashier',
        },
        {
          requestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          lines: [
            {
              productId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
              unit: 'each',
              quantity: 1.5,
            },
          ],
        },
      ),
    ).rejects.toThrow('whole-number');
    expect(executeSuspendedOrder).not.toHaveBeenCalled();
  });
});
