import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DatabaseService } from '../database/database.service.js';
import { type ShiftActor, ShiftsWrites } from './shifts-writes.js';

export type CurrentShift = {
  shiftId: string;
  openingCashMinor: number;
  status: 'open';
  openedAt: string;
};

export type ShiftInput = {
  requestId?: unknown;
  reason?: unknown;
  openingCashMinor?: unknown;
  closingCashMinor?: unknown;
  shiftId?: unknown;
};

@Injectable()
export class ShiftsService {
  constructor(
    @Inject(ShiftsWrites) private readonly writes: ShiftsWrites,
    @Inject(DatabaseService) private readonly database: DatabaseService,
  ) {}

  async currentShift(userId: string): Promise<{ shift: CurrentShift | null }> {
    const result = await this.database.connectionPool.query<{
      id: string;
      opening_cash_minor: string;
      status: 'open';
      opened_at: string;
    }>(
      `SELECT id, opening_cash_minor::text, status, opened_at
       FROM cash_shift WHERE cashier_id = $1 AND status = 'open'
       ORDER BY opened_at DESC LIMIT 1`,
      [userId],
    );
    const row = result.rows[0];
    return {
      shift: row
        ? {
            shiftId: row.id,
            openingCashMinor: Number(row.opening_cash_minor),
            status: row.status,
            openedAt: row.opened_at,
          }
        : null,
    };
  }

  async openShift(actor: ShiftActor, value: unknown) {
    const body =
      value && typeof value === 'object' ? (value as ShiftInput) : {};
    const requestId =
      typeof body.requestId === 'string' && body.requestId.trim()
        ? body.requestId
        : null;
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 3
        ? body.reason.trim()
        : null;
    const openingCashMinor = Number(body.openingCashMinor);

    if (!requestId) throw new BadRequestException('Provide a valid request ID');
    if (!reason)
      throw new BadRequestException(
        'Reason must contain at least three characters',
      );
    if (
      !Number.isFinite(openingCashMinor) ||
      openingCashMinor < 0 ||
      !Number.isInteger(openingCashMinor)
    ) {
      throw new BadRequestException(
        'Opening cash must be a non-negative integer minor amount',
      );
    }

    return this.writes.execute(
      actor,
      requestId,
      { reason, openingCashMinor },
      async (client) => {
        const shiftId = randomUUID();
        const shift = await client.query<{ id: string; opened_at: string }>(
          `INSERT INTO cash_shift (id, cashier_id, opening_cash_minor, status, reason, opened_at)
          VALUES ($1, $2, $3, 'open', $4, now()) RETURNING id, opened_at`,
          [shiftId, actor.userId, openingCashMinor, reason],
        );

        const movement = await client.query<{ id: string }>(
          `INSERT INTO cash_movement (id, shift_id, kind, amount_minor, reason, created_at)
          VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
          [randomUUID(), shift.rows[0].id, 'opening', openingCashMinor, reason],
        );

        return {
          shiftId: shift.rows[0].id,
          openingCashMinor,
          openedAt: shift.rows[0].opened_at,
          movementId: movement.rows[0].id,
          status: 'open',
        };
      },
    );
  }

  async closeShift(actor: ShiftActor, value: unknown) {
    const body =
      value && typeof value === 'object' ? (value as ShiftInput) : {};
    const requestId =
      typeof body.requestId === 'string' && body.requestId.trim()
        ? body.requestId
        : null;
    const shiftId =
      typeof body.shiftId === 'string' && body.shiftId.trim()
        ? body.shiftId
        : null;
    const reason =
      typeof body.reason === 'string' && body.reason.trim().length >= 3
        ? body.reason.trim()
        : null;
    const closingCashMinor = Number(body.closingCashMinor);

    if (!requestId) throw new BadRequestException('Provide a valid request ID');
    if (!shiftId) throw new BadRequestException('Provide a valid shift ID');
    if (!reason)
      throw new BadRequestException(
        'Reason must contain at least three characters',
      );
    if (
      !Number.isFinite(closingCashMinor) ||
      closingCashMinor < 0 ||
      !Number.isInteger(closingCashMinor)
    ) {
      throw new BadRequestException(
        'Closing cash must be a non-negative integer minor amount',
      );
    }

    return this.writes.execute(
      actor,
      requestId,
      { shiftId, reason, closingCashMinor },
      async (client) => {
        const shift = await client.query<{
          id: string;
          cashier_id: string;
          opening_cash_minor: number;
          status: string;
        }>(
          `SELECT id, cashier_id, opening_cash_minor, status FROM cash_shift WHERE id = $1 FOR UPDATE`,
          [shiftId],
        );
        if (!shift.rowCount) {
          throw new NotFoundException('Shift not found');
        }
        if (
          actor.role !== 'manager' &&
          shift.rows[0].cashier_id !== actor.userId
        ) {
          throw new ConflictException(
            'Cashiers can only close their own shift',
          );
        }
        if (shift.rows[0].status !== 'open') {
          throw new ConflictException('Shift is already closed');
        }

        const cash = await client.query<{ expected_cash_minor: string }>(
          `SELECT COALESCE(SUM(
            CASE WHEN kind IN ('opening', 'cash_in') THEN amount_minor ELSE -amount_minor END
          ), 0)::text AS expected_cash_minor
          FROM cash_movement WHERE shift_id = $1`,
          [shiftId],
        );
        const expectedCashMinor = Number(
          cash.rows[0]?.expected_cash_minor ??
            shift.rows[0].opening_cash_minor ??
            0,
        );
        const variance = closingCashMinor - expectedCashMinor;

        await client.query(
          `UPDATE cash_shift
          SET status = 'closed', closing_cash_minor = $1, variance_minor = $2, reason = $3, closed_at = now()
          WHERE id = $4`,
          [closingCashMinor, variance, reason, shiftId],
        );

        const movement = await client.query<{ id: string }>(
          `INSERT INTO cash_movement (id, shift_id, kind, amount_minor, reason, created_at)
          VALUES ($1, $2, $3, $4, $5, now()) RETURNING id`,
          [randomUUID(), shiftId, 'closing', closingCashMinor, reason],
        );

        return {
          shiftId,
          status: 'closed',
          expectedCashMinor,
          varianceMinor: variance,
          closingCashMinor,
          movementId: movement.rows[0].id,
        };
      },
    );
  }
}
