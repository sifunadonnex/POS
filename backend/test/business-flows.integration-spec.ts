import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Test, type TestingModule } from '@nestjs/testing';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { DatabaseService } from '../src/database/database.service.js';
import { PurchasesService } from '../src/purchases/purchases.service.js';
import { PurchasesWrites } from '../src/purchases/purchases-writes.js';
import { SuppliersService } from '../src/purchases/suppliers.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { SalesService } from '../src/sales/sales.service.js';
import { SalesWrites } from '../src/sales/sales-writes.js';
import { ShiftsService } from '../src/shifts/shifts.service.js';
import { ShiftsWrites } from '../src/shifts/shifts-writes.js';

type StaffActor = {
  userId: string;
  sessionId: string;
  role: 'manager' | 'cashier';
};

// Uses only a disposable schema in an explicit _test database.
describe('PostgreSQL register and purchase business flows', () => {
  let pool: Pool;
  let fixture: TestingModule;
  let purchases: PurchasesService;
  let suppliers: SuppliersService;
  let reports: ReportsService;
  let sales: SalesService;
  let shifts: ShiftsService;
  const schema = `business_${randomUUID().replaceAll('-', '')}`;
  const manager: StaffActor = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    role: 'manager',
  };
  const cashier: StaffActor = {
    userId: randomUUID(),
    sessionId: randomUUID(),
    role: 'cashier',
  };
  const productId = randomUUID();

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test')) {
      throw new Error('Explicit TEST_DATABASE_URL ending in _test is required');
    }
    const config = parseEnvironment({
      DATABASE_URL: url,
      DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
      NODE_ENV: 'test',
    });
    pool = new Pool({
      ...databaseOptions(config),
      options: `-c search_path=${schema}`,
    });
    await pool.query(`CREATE SCHEMA "${schema}"`);
    const client = await pool.connect();
    try {
      await runner({
        dbClient: client,
        dir: fileURLToPath(new URL('../migrations/', import.meta.url)),
        schema,
        migrationsSchema: schema,
        migrationsTable: 'pgmigrations',
        direction: 'up',
        singleTransaction: true,
        log: () => undefined,
      });
    } finally {
      client.release();
    }

    for (const actor of [manager, cashier]) {
      await pool.query(
        `INSERT INTO "user" (id, name, email, role, "emailVerified", "twoFactorEnabled")
        VALUES ($1, $2, $3, $4, true, true)`,
        [
          actor.userId,
          `${actor.role} integration`,
          `${actor.role}-${schema}@example.test`,
          actor.role,
        ],
      );
      await pool.query(
        `INSERT INTO session (id, "userId", token, "expiresAt", "mfaVerified")
        VALUES ($1, $2, $3, now() + interval '1 hour', true)`,
        [actor.sessionId, actor.userId, randomUUID()],
      );
    }

    await pool.query(
      `INSERT INTO catalogue_product (id, sku, name, unit, price_minor, active)
      VALUES ($1, 'FLOUR-2KG', 'Premium flour', 'each', 250, true)`,
      [productId],
    );

    fixture = await Test.createTestingModule({
      providers: [
        PurchasesService,
        PurchasesWrites,
        SuppliersService,
        ReportsService,
        SalesService,
        SalesWrites,
        ShiftsService,
        ShiftsWrites,
        { provide: DatabaseService, useValue: { connectionPool: pool } },
      ],
    }).compile();
    purchases = fixture.get(PurchasesService);
    suppliers = fixture.get(SuppliersService);
    reports = fixture.get(ReportsService);
    sales = fixture.get(SalesService);
    shifts = fixture.get(ShiftsService);
  });

  afterAll(async () => {
    try {
      if (fixture) await fixture.close();
    } finally {
      if (pool) {
        try {
          await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await pool.end();
        }
      }
    }
  });

  it('replays a supplier receipt once, reconciles its return, and exposes the signed ledger', async () => {
    const supplier = await suppliers.create(manager, {
      requestId: randomUUID(),
      name: 'Northern Mills',
      reason: 'Approved supplier setup',
    });
    const receiveRequestId = randomUUID();
    const receiveInput = {
      requestId: receiveRequestId,
      supplierId: supplier.supplier.id,
      reason: 'Morning flour delivery',
      lines: [{ productId, quantity: 12, unitCostMinor: 180 }],
    };
    const [firstReceipt, replayedReceipt] = await Promise.all([
      purchases.receive(manager, receiveInput),
      purchases.receive(manager, receiveInput),
    ]);
    expect(replayedReceipt).toEqual(firstReceipt);
    expect(firstReceipt.totalMinor).toBe(2160);
    expect(
      (
        await pool.query<{ count: number }>(
          'SELECT COUNT(*)::int AS count FROM purchase_receipt',
        )
      ).rows[0].count,
    ).toBe(1);

    const returnInput = {
      requestId: randomUUID(),
      receiptId: firstReceipt.receiptId,
      reason: 'Damaged delivery bags',
      lines: [{ productId, quantityMinor: 2 }],
    };
    const firstReturn = await purchases.returnReceipt(manager, returnInput);
    const replayedReturn = await purchases.returnReceipt(manager, returnInput);
    expect(replayedReturn).toEqual(firstReturn);
    expect(firstReturn.totalMinor).toBe(360);
    expect(
      (
        await pool.query<{ quantity_minor: string }>(
          'SELECT quantity_minor::text FROM inventory_stock WHERE product_id = $1',
          [productId],
        )
      ).rows[0].quantity_minor,
    ).toBe('10');

    const day = (
      await pool.query<{ day: string }>(
        "SELECT to_char(current_date, 'YYYY-MM-DD') AS day",
      )
    ).rows[0].day;
    const reconciliation = await reports.purchaseReconciliation(day, day);
    expect(reconciliation.summary).toEqual({
      receiptCount: 1,
      receivedTotalMinor: 2160,
      returnCount: 1,
      returnedTotalMinor: 360,
      netPurchasesMinor: 1800,
      supplierCount: 1,
    });
    expect(reconciliation.suppliers).toMatchObject([
      {
        supplierId: supplier.supplier.id,
        supplierName: 'Northern Mills',
        receiptCount: 1,
        receivedTotalMinor: 2160,
        returnCount: 1,
        returnedTotalMinor: 360,
        netPurchasesMinor: 1800,
      },
    ]);
    expect(reconciliation.receipts).toMatchObject([
      {
        receiptId: firstReceipt.receiptId,
        supplierId: supplier.supplier.id,
        totalMinor: 2160,
        returnedTotalMinor: 360,
        netTotalMinor: 1800,
        lineCount: 1,
      },
    ]);

    const ledger = await suppliers.ledger(supplier.supplier.id, day, day, 0);
    expect(ledger.entries).toHaveLength(2);
    expect(ledger.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'receipt',
          receiptId: firstReceipt.receiptId,
          signedMinor: 2160,
        }),
        expect.objectContaining({
          kind: 'return',
          receiptId: firstReceipt.receiptId,
          signedMinor: -360,
        }),
      ]),
    );
  });

  it('links a replay-safe cash payment to the active shift and closes against the movement ledger', async () => {
    const opened = await shifts.openShift(cashier, {
      requestId: randomUUID(),
      reason: 'Cashier float',
      openingCashMinor: 1000,
    });
    expect((await shifts.currentShift(cashier.userId)).shift).toMatchObject({
      shiftId: opened.shiftId,
      openingCashMinor: 1000,
      status: 'open',
    });

    const saleRequestId = randomUUID();
    const saleInput = {
      requestId: saleRequestId,
      reason: 'Counter sale',
      lines: [{ productId, unit: 'each', quantity: 2 }],
    };
    const [sale, replayedSale] = await Promise.all([
      sales.finalize(cashier, saleInput),
      sales.finalize(cashier, saleInput),
    ]);
    expect(replayedSale).toEqual(sale);
    expect(sale.totalMinor).toBe(500);
    expect(
      (
        await pool.query<{ quantity_minor: string }>(
          'SELECT quantity_minor::text FROM inventory_stock WHERE product_id = $1',
          [productId],
        )
      ).rows[0].quantity_minor,
    ).toBe('8');

    const paymentInput = {
      requestId: randomUUID(),
      saleId: sale.saleId,
      kind: 'cash' as const,
      amountMinor: 500,
      reason: 'Cash received',
    };
    const [payment, replayedPayment] = await Promise.all([
      sales.recordPayment(cashier, paymentInput),
      sales.recordPayment(cashier, paymentInput),
    ]);
    expect(replayedPayment).toEqual(payment);
    expect(payment.shiftId).toBe(opened.shiftId);
    expect(
      (
        await pool.query<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM cash_movement WHERE kind = 'cash_in'",
        )
      ).rows[0].count,
    ).toBe(1);

    const closed = await shifts.closeShift(cashier, {
      requestId: randomUUID(),
      shiftId: opened.shiftId,
      reason: 'Counted till cash',
      closingCashMinor: 1500,
    });
    expect(closed).toMatchObject({
      shiftId: opened.shiftId,
      status: 'closed',
      expectedCashMinor: 1500,
      varianceMinor: 0,
    });
    expect((await shifts.currentShift(cashier.userId)).shift).toBeNull();

    const day = (
      await pool.query<{ day: string }>(
        "SELECT to_char(current_date, 'YYYY-MM-DD') AS day",
      )
    ).rows[0].day;
    expect(await reports.summary(day)).toMatchObject({
      saleCount: 1,
      salesTotalMinor: 500,
      paymentCount: 1,
      cashMinor: 500,
      refundCount: 0,
      refundMinor: 0,
      closedShiftCount: 1,
      varianceMinor: 0,
    });
  });
});
