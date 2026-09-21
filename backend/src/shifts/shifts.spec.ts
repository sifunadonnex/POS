import { Test } from '@nestjs/testing';
import { DatabaseService } from '../database/database.service.js';
import { ShiftsService } from './shifts.service.js';
import { ShiftsWrites } from './shifts-writes.js';

describe('ShiftsService', () => {
  it('returns the active shift for a register refresh', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('FROM cash_shift WHERE cashier_id')) {
        return {
          rows: [
            {
              id: 'shift-1',
              opening_cash_minor: '5000',
              status: 'open',
              opened_at: '2026-09-21T08:00:00.000Z',
            },
          ],
        };
      }
      return { rows: [] };
    });
    const module = await Test.createTestingModule({
      providers: [
        ShiftsService,
        ShiftsWrites,
        {
          provide: DatabaseService,
          useValue: { connectionPool: { query, connect: vi.fn() } },
        },
      ],
    }).compile();

    await expect(
      module.get(ShiftsService).currentShift('cashier'),
    ).resolves.toEqual({
      shift: {
        shiftId: 'shift-1',
        openingCashMinor: 5000,
        status: 'open',
        openedAt: '2026-09-21T08:00:00.000Z',
      },
    });
  });

  it('opens a shift and stores the opening float', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'cashier' }] };
      }
      if (
        sql.includes(
          'SELECT actor_id, fingerprint, response FROM shift_request',
        )
      ) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO cash_shift')) {
        return { rows: [{ id: 'shift-1' }] };
      }
      if (sql.includes('INSERT INTO cash_movement')) {
        return { rows: [{ id: 'movement-1' }] };
      }
      if (sql.includes('INSERT INTO shift_request')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        ShiftsService,
        ShiftsWrites,
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

    const service = module.get(ShiftsService);
    const result = await service.openShift(
      { userId: 'cashier', sessionId: 'session', role: 'cashier' },
      {
        requestId: '11111111-1111-4111-8111-111111111111',
        reason: 'Opening float',
        openingCashMinor: 5000,
      },
    );

    expect(result.shiftId).toBe('shift-1');
    expect(result.openingCashMinor).toBe(5000);
  });

  it('closes an open shift and records variance', async () => {
    const query = vi.fn(async (sql: string) => {
      if (sql.includes('SELECT pg_advisory_xact_lock')) {
        return { rows: [] };
      }
      if (sql.includes('SELECT u.id FROM "user" u JOIN session s')) {
        return { rowCount: 1, rows: [{ id: 'manager' }] };
      }
      if (
        sql.includes(
          'SELECT actor_id, fingerprint, response FROM shift_request',
        )
      ) {
        return { rows: [] };
      }
      if (
        sql.includes(
          'SELECT id, cashier_id, opening_cash_minor, status FROM cash_shift',
        )
      ) {
        return {
          rowCount: 1,
          rows: [
            {
              id: 'shift-1',
              cashier_id: 'cashier',
              opening_cash_minor: 5000,
              status: 'open',
            },
          ],
        };
      }
      if (sql.includes('expected_cash_minor')) {
        return { rows: [{ expected_cash_minor: '5000' }] };
      }
      if (sql.includes('UPDATE cash_shift')) {
        return { rows: [] };
      }
      if (sql.includes('INSERT INTO cash_movement')) {
        return { rows: [{ id: 'movement-2' }] };
      }
      if (sql.includes('INSERT INTO shift_request')) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const module = await Test.createTestingModule({
      providers: [
        ShiftsService,
        ShiftsWrites,
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

    const service = module.get(ShiftsService);
    const result = await service.closeShift(
      { userId: 'manager', sessionId: 'session', role: 'manager' },
      {
        requestId: '22222222-2222-4222-8222-222222222222',
        shiftId: 'shift-1',
        reason: 'Close shift',
        closingCashMinor: 5200,
      },
    );

    expect(result.status).toBe('closed');
    expect(result.varianceMinor).toBe(200);
  });
});
