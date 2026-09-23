import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Test, type TestingModule } from '@nestjs/testing';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { DatabaseService } from '../src/database/database.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { InventoryWrites } from '../src/inventory/inventory-writes.js';
import { PurchasesService } from '../src/purchases/purchases.service.js';
import { PurchasesWrites } from '../src/purchases/purchases-writes.js';
import { SuppliersService } from '../src/purchases/suppliers.service.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { ReturnsService } from '../src/returns/returns.service.js';
import { ReturnsWrites } from '../src/returns/returns-writes.js';
import { SalesService } from '../src/sales/sales.service.js';
import { SalesLookupService } from '../src/sales/sales-lookup.service.js';
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
  let inventory: InventoryService;
  let suppliers: SuppliersService;
  let reports: ReportsService;
  let returns: ReturnsService;
  let sales: SalesService;
  let saleLookup: SalesLookupService;
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
  const fractionalProductId = randomUUID();

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
      const managerSecurity = actor.role === 'manager';
      await pool.query(
        `INSERT INTO "user" (id, name, email, role, "emailVerified", "twoFactorEnabled")
        VALUES ($1, $2, $3, $4, true, $5)`,
        [
          actor.userId,
          `${actor.role} integration`,
          `${actor.role}-${schema}@example.test`,
          actor.role,
          managerSecurity,
        ],
      );
      await pool.query(
        `INSERT INTO session (id, "userId", token, "expiresAt", "mfaVerified")
        VALUES ($1, $2, $3, now() + interval '1 hour', $4)`,
        [actor.sessionId, actor.userId, randomUUID(), managerSecurity],
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
        InventoryService,
        InventoryWrites,
        SuppliersService,
        ReportsService,
        ReturnsService,
        ReturnsWrites,
        SalesService,
        SalesLookupService,
        SalesWrites,
        ShiftsService,
        ShiftsWrites,
        { provide: DatabaseService, useValue: { connectionPool: pool } },
      ],
    }).compile();
    purchases = fixture.get(PurchasesService);
    inventory = fixture.get(InventoryService);
    suppliers = fixture.get(SuppliersService);
    reports = fixture.get(ReportsService);
    returns = fixture.get(ReturnsService);
    sales = fixture.get(SalesService);
    saleLookup = fixture.get(SalesLookupService);
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
    await expect(inventory.stock('', 0)).resolves.toMatchObject({
      stock: [
        {
          productId,
          quantityMinor: 10,
        },
      ],
    });

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

  it('checks out tendered cash once, records change, and closes against the movement ledger', async () => {
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

    const checkoutInput = {
      requestId: randomUUID(),
      reason: 'Cash counter sale',
      lines: [{ productId, unit: 'each', quantity: 2 }],
      cashTenderedMinor: 1000,
    };
    const [sale, replayedSale] = await Promise.all([
      sales.checkout(cashier, checkoutInput),
      sales.checkout(cashier, checkoutInput),
    ]);
    expect(replayedSale).toEqual(sale);
    expect(sale.totalMinor).toBe(500);
    expect(sale.payment).toMatchObject({
      amountMinor: 500,
      tenderedMinor: 1000,
      changeMinor: 500,
      shiftId: opened.shiftId,
    });
    expect(
      (
        await pool.query<{ quantity_minor: string }>(
          'SELECT quantity_minor::text FROM inventory_stock WHERE product_id = $1',
          [productId],
        )
      ).rows[0].quantity_minor,
    ).toBe('8');

    expect(
      (
        await pool.query<{ count: number }>(
          "SELECT COUNT(*)::int AS count FROM cash_movement WHERE kind = 'cash_in'",
        )
      ).rows[0].count,
    ).toBe(1);
    expect(
      (
        await pool.query<{ amount_minor: string }>(
          "SELECT amount_minor::text FROM cash_movement WHERE kind = 'cash_in'",
        )
      ).rows[0].amount_minor,
    ).toBe('1000');
    expect(
      (
        await pool.query<{ amount_minor: string }>(
          "SELECT amount_minor::text FROM cash_movement WHERE kind = 'cash_out'",
        )
      ).rows[0].amount_minor,
    ).toBe('500');
    await expect(saleLookup.receipt(sale.saleId)).resolves.toMatchObject({
      saleId: sale.saleId,
      totalMinor: 500,
      payments: [
        {
          paymentId: sale.payment.paymentId,
          amountMinor: 500,
          tenderedMinor: 1000,
          changeMinor: 500,
        },
      ],
    });

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

  it('rounds a fractional sale half up and allocates repeated refunds cumulatively', async () => {
    await pool.query(
      `INSERT INTO catalogue_product (id, sku, name, unit, price_minor, active)
      VALUES ($1, 'OIL-KG', 'Cooking oil by weight', 'kg', 1001, true)`,
      [fractionalProductId],
    );
    await pool.query(
      `INSERT INTO inventory_stock (product_id, unit, quantity_minor)
      VALUES ($1, 'kg', 2000)`,
      [fractionalProductId],
    );
    await shifts.openShift(cashier, {
      requestId: randomUUID(),
      reason: 'Fractional sale float',
      openingCashMinor: 0,
    });
    const sale = await sales.checkout(cashier, {
      requestId: randomUUID(),
      reason: 'Fractional counter sale',
      lines: [{ productId: fractionalProductId, unit: 'kg', quantity: 1 }],
      cashTenderedMinor: 1100,
    });
    expect(sale.totalMinor).toBe(1001);

    const returnQuantities = [333, 333, 333, 1];
    const expectedRefunds = [333, 334, 333, 1];
    for (const [index, quantityMinor] of returnQuantities.entries()) {
      const result = await returns.createReturn(manager, {
        requestId: randomUUID(),
        saleId: sale.saleId,
        reason: `Fractional return ${index + 1}`,
        lines: [{ productId: fractionalProductId, quantityMinor }],
      });
      expect(result.amountMinor).toBe(expectedRefunds[index]);
    }

    const stored = await pool.query<{
      line_total_minor: string;
      refund_minor: string;
      returned_quantity_minor: string;
      stock_quantity_minor: string;
    }>(
      `SELECT sl.line_total_minor::text,
      (SELECT SUM(amount_minor)::text FROM sale_refund WHERE sale_id = s.id) AS refund_minor,
      (SELECT SUM(quantity_minor)::text FROM sale_return_line WHERE sale_line_id = sl.id) AS returned_quantity_minor,
      (SELECT quantity_minor::text FROM inventory_stock WHERE product_id = sl.product_id) AS stock_quantity_minor
      FROM sale s JOIN sale_line sl ON sl.sale_id = s.id WHERE s.id = $1`,
      [sale.saleId],
    );
    expect(stored.rows[0]).toEqual({
      line_total_minor: '1001',
      refund_minor: '1001',
      returned_quantity_minor: '1000',
      stock_quantity_minor: '2000',
    });
  });
});
