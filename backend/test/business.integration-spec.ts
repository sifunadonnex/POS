import { SuspendedOrdersService } from '../src/sales/suspended-orders.service.js';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { runner } from 'node-pg-migrate';
import { hashPassword } from 'better-auth/crypto';
import { APP_CONFIG, parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { DatabaseService } from '../src/database/database.service.js';
import {
  businessScope,
  type BusinessScope,
} from '../src/business/business-scope.js';
import { CatalogueService } from '../src/catalogue/catalogue.service.js';
import { CatalogueWrites } from '../src/catalogue/catalogue-writes.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { InventoryWrites } from '../src/inventory/inventory-writes.js';
import { SalesService } from '../src/sales/sales.service.js';
import { SalesWrites } from '../src/sales/sales-writes.js';
import { RegisterBasketService } from '../src/sales/register-basket.service.js';
import { CartApprovalService } from '../src/sales/cart-approval.service.js';
import { ShiftsService } from '../src/shifts/shifts.service.js';
import { ShiftsWrites } from '../src/shifts/shifts-writes.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { ReturnsService } from '../src/returns/returns.service.js';
import { ReturnsWrites } from '../src/returns/returns-writes.js';
import { ValuationService } from '../src/inventory/valuation.service.js';
import { PurchasesService } from '../src/purchases/purchases.service.js';
import { PurchasesWrites } from '../src/purchases/purchases-writes.js';

describe('branches, departments, expiry and supermarket cart approvals', () => {
  const schema = `business_${randomUUID().replaceAll('-', '')}`;
  const branch = randomUUID(),
    minimart = randomUUID(),
    liquor = randomUUID(),
    minimartTill = randomUUID(),
    liquorTill = randomUUID();
  const manager = { userId: randomUUID(), sessionId: randomUUID() };
  const cashier = { userId: randomUUID(), sessionId: randomUUID() };
  const second = { userId: randomUUID(), sessionId: randomUUID() };
  const supervisor = { userId: randomUUID(), sessionId: randomUUID() };
  const supervisorPassword = 'Disposable-supervisor-2026!';
  const command = () => ({
    requestId: randomUUID(),
    reason: 'Disposable business verification',
  });
  const scope = (
    userId: string,
    departmentId = minimart,
    tillId = minimartTill,
  ): BusinessScope => ({
    userId,
    departmentId,
    tillId,
    manager: userId === manager.userId,
  });
  let pool: Pool,
    catalogue: CatalogueService,
    inventory: InventoryService,
    basket: RegisterBasketService,
    sales: SalesService,
    shifts: ShiftsService,
    reports: ReportsService,
    returns: ReturnsService,
    valuation: ValuationService,
    purchases: PurchasesService,
    heldOrders: SuspendedOrdersService;
  let food: { id: string }, drink: { id: string };
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Explicit _test database is required');
    const config = parseEnvironment({
      DATABASE_URL: url,
      DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
      NODE_ENV: 'test',
    });
    pool = new Pool({
      ...databaseOptions(config),
      max: 5,
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
    for (const [actor, role] of [
      [manager, 'manager'],
      [cashier, 'cashier'],
      [second, 'cashier'],
      [supervisor, 'supervisor'],
    ] as const) {
      await pool.query(
        'INSERT INTO "user"(id, name, email, role, "emailVerified", "twoFactorEnabled") VALUES ($1, $2, $3, $2, true, $4)',
        [
          actor.userId,
          role,
          `${role}-${actor.userId}@example.test`,
          role !== 'cashier',
        ],
      );
      await pool.query(
        'INSERT INTO session(id, "userId", token, "expiresAt", "mfaVerified") VALUES ($1, $2, $3, now() + interval \'1 hour\', $4)',
        [actor.sessionId, actor.userId, randomUUID(), role !== 'cashier'],
      );
    }
    await pool.query(
      'INSERT INTO account(id, "userId", "accountId", "providerId", password) VALUES ($1, $2, $2, \'credential\', $3)',
      [randomUUID(), supervisor.userId, await hashPassword(supervisorPassword)],
    );
    await pool.query(
      "INSERT INTO business_branch(id, name) VALUES ($1, 'Test branch')",
      [branch],
    );
    await pool.query(
      "INSERT INTO business_department(id, branch_id, name) VALUES ($1, $3, 'POP N GO Minimart'), ($2, $3, 'POP N GO Liquor')",
      [minimart, liquor, branch],
    );
    await pool.query(
      "INSERT INTO business_till(id, department_id, name) VALUES ($1, $2, 'Minimart till'), ($3, $4, 'Liquor till')",
      [minimartTill, minimart, liquorTill, liquor],
    );
    for (const actor of [cashier, second, supervisor])
      await pool.query(
        'INSERT INTO staff_department_access(user_id, department_id, home) VALUES ($1, $2, true)',
        [actor.userId, minimart],
      );
    const fixture = await Test.createTestingModule({
      providers: [
        CatalogueService,
        CatalogueWrites,
        InventoryService,
        InventoryWrites,
        SalesService,
        SalesWrites,
        RegisterBasketService,
        SuspendedOrdersService,
        CartApprovalService,
        ShiftsService,
        ShiftsWrites,
        ReportsService,
        ReturnsService,
        ReturnsWrites,
        ValuationService,
        PurchasesService,
        PurchasesWrites,
        { provide: DatabaseService, useValue: { connectionPool: pool } },
        { provide: APP_CONFIG, useValue: config },
      ],
    }).compile();
    heldOrders = fixture.get(SuspendedOrdersService);
    catalogue = fixture.get(CatalogueService);
    inventory = fixture.get(InventoryService);
    basket = fixture.get(RegisterBasketService);
    sales = fixture.get(SalesService);
    shifts = fixture.get(ShiftsService);
    reports = fixture.get(ReportsService);
    returns = fixture.get(ReturnsService);
    valuation = fixture.get(ValuationService);
    purchases = fixture.get(PurchasesService);
    const input = {
      name: 'Test food',
      sku: 'FOOD',
      categoryId: null,
      unit: 'each',
      price: '25.00',
      lowStockThreshold: null,
      taxCode: null,
      active: true,
      barcodes: [],
    };
    await businessScope.run(scope(manager.userId), async () => {
      const response = await catalogue.createProduct(manager, {
        ...input,
        ...command(),
        expiryDate: new Date().toISOString().slice(0, 10),
      });
      if (!response || typeof response !== 'object' || !('product' in response))
        throw new Error('Missing product');
      const row = await pool.query<{ id: string }>(
        "SELECT id FROM catalogue_product WHERE sku = 'FOOD'",
      );
      food = row.rows[0];
      await inventory.opening(manager, {
        ...command(),
        productId: food.id,
        quantity: 50,
      });
    });
    await businessScope.run(
      scope(manager.userId, liquor, liquorTill),
      async () => {
        await catalogue.createProduct(manager, {
          ...input,
          ...command(),
          sku: 'DRINK',
          name: 'Test drink',
        });
        const row = await pool.query<{ id: string }>(
          "SELECT id FROM catalogue_product WHERE sku = 'DRINK'",
        );
        drink = row.rows[0];
        await inventory.opening(manager, {
          ...command(),
          productId: drink.id,
          quantity: 50,
        });
      },
    );
  });
  afterAll(async () => {
    if (pool) {
      try {
        await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      } finally {
        await pool.end();
      }
    }
  });

  it('does not guess a branch or expiry period, and restricts catalogue and stock reads', async () => {
    const settings = await pool.query(
      'SELECT expiry_warning_days FROM business_setting',
    );
    expect(settings.rows[0].expiry_warning_days).toBeNull();
    await businessScope.run(scope(cashier.userId), async () => {
      expect(
        (await catalogue.products({}, false)).products.map((p) => p.id),
      ).toEqual([food.id]);
      expect(
        (await inventory.stock('', '0')).stock.map((p) => p.productId),
      ).toEqual([food.id]);
      await expect(
        sales.quoteCurrentBasket([
          { productId: drink.id, unit: 'each', quantity: 1 },
        ]),
      ).rejects.toThrow('Product not found');
    });
  });
  it('requires supervisor credentials for reductions and preserves the basket on denial', async () => {
    await businessScope.run(scope(cashier.userId), async () => {
      const added = await basket.save(cashier, {
        requestId: randomUUID(),
        revision: 0,
        lines: [{ productId: food.id, unit: 'each', quantity: 3 }],
      });
      await expect(
        basket.save(cashier, {
          requestId: randomUUID(),
          revision: added.revision,
          lines: [{ productId: food.id, unit: 'each', quantity: 1 }],
        }),
      ).rejects.toThrow();
      expect((await basket.read(cashier)).lines[0].quantity).toBe(3);
      const reduced = await basket.save(cashier, {
        requestId: randomUUID(),
        revision: added.revision,
        lines: [{ productId: food.id, unit: 'each', quantity: 1 }],
        approval: {
          email: `supervisor-${supervisor.userId}@example.test`,
          password: supervisorPassword,
          reason: 'Customer removed two items',
        },
      });
      expect(reduced.revision).toBeGreaterThan(added.revision);
      const approvals = await pool.query<{
        actor_id: string;
        detail: { target: { kind: string; revision: number } };
      }>(
        "SELECT actor_id, detail FROM auth_audit WHERE action = 'cart.approval' AND outcome = 'success'",
      );
      expect(approvals.rows[0].actor_id).toBe(supervisor.userId);
      expect(approvals.rows[0].detail.target.kind).toBe('basket');
      expect(JSON.stringify(approvals.rows)).not.toContain(supervisorPassword);
      await expect(
        basket.save(cashier, {
          requestId: randomUUID(),
          revision: reduced.revision,
          lines: [
            { productId: food.id, unit: 'each', quantity: 1 },
            { productId: food.id, unit: 'each', quantity: 1 },
          ],
        }),
      ).rejects.toThrow('one basket line');
    });
  });
  it('allows one open shift per physical till and refuses direct checkout basket tampering', async () => {
    await businessScope.run(scope(cashier.userId), async () => {
      await shifts.openShift(
        { ...cashier, role: 'cashier' },
        { ...command(), openingCashMinor: 1000 },
      );
      await expect(
        sales.checkout(cashier, {
          ...command(),
          cashTenderedMinor: 2500,
          lines: [{ productId: food.id, unit: 'each', quantity: 2 }],
        }),
      ).rejects.toThrow('basket changed');
      const before = await pool.query(
        'SELECT quantity_minor FROM inventory_stock WHERE product_id = $1',
        [food.id],
      );
      expect(Number(before.rows[0].quantity_minor)).toBe(50);
      const result = await sales.checkout(cashier, {
        ...command(),
        cashTenderedMinor: 2500,
        lines: [{ productId: food.id, unit: 'each', quantity: 1 }],
      });
      const sale = await pool.query(
        'SELECT department_id, till_id FROM sale WHERE id = $1',
        [result.saleId],
      );
      expect(sale.rows[0]).toEqual({
        department_id: minimart,
        till_id: minimartTill,
      });
      expect((await basket.read(cashier)).lines).toEqual([]);
    });
    await businessScope.run(scope(second.userId), async () => {
      await expect(
        shifts.openShift(
          { ...second, role: 'cashier' },
          { ...command(), openingCashMinor: 1000 },
        ),
      ).rejects.toThrow();
    });
  });
  it('rejects missing/expired cover grants inside the write transaction', async () => {
    await pool.query(
      "INSERT INTO staff_department_access(user_id, department_id, expires_at) VALUES ($1, $2, now() - interval '1 second')",
      [cashier.userId, liquor],
    );
    await businessScope.run(
      scope(cashier.userId, liquor, liquorTill),
      async () => {
        await expect(
          basket.save(cashier, {
            requestId: randomUUID(),
            revision: 0,
            lines: [{ productId: drink.id, unit: 'each', quantity: 1 }],
          }),
        ).rejects.toThrow('expired or was revoked');
      },
    );
    await pool.query(
      "UPDATE staff_department_access SET expires_at = now() + interval '1 hour' WHERE user_id = $1 AND department_id = $2",
      [cashier.userId, liquor],
    );
    await businessScope.run(
      scope(cashier.userId, liquor, liquorTill),
      async () => {
        const saved = await basket.save(cashier, {
          requestId: randomUUID(),
          revision: 0,
          lines: [{ productId: drink.id, unit: 'each', quantity: 1 }],
        });
        expect(saved.quote.totalMinor).toBe(2500);
      },
    );
  });
  it('uses the configured expiry window and department-filtered daily totals', async () => {
    await pool.query('UPDATE business_setting SET expiry_warning_days = 7');
    await businessScope.run(scope(manager.userId), async () => {
      const alerts = await reports.expiryAlerts();
      expect(alerts.warningDays).toBe(7);
      expect(alerts.items.map((p) => p.productId)).toContain(food.id);
      expect(
        alerts.items.find((p) => p.productId === food.id)?.departmentLabel,
      ).toBe('Test branch · POP N GO Minimart');
    });
    const day = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
    }).format(new Date());
    await businessScope.run(scope(manager.userId), async () => {
      expect(
        (await reports.departmentSales(day)).departments.find(
          (d) => d.name === 'POP N GO Minimart',
        )?.salesMinor,
      ).toBe(2500);
    });
    await businessScope.run(
      scope(manager.userId, liquor, liquorTill),
      async () => {
        expect((await reports.expiryAlerts()).items).toEqual([]);
        const day = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'Africa/Nairobi',
        }).format(new Date());
        expect((await reports.summary(day)).salesTotalMinor).toBe(0);
      },
    );
  });
  it('supports shared SKU/barcodes across branches while keeping balances and lookups separate', async () => {
    const branchId = randomUUID(),
      departmentId = randomUUID(),
      tillId = randomUUID();
    await pool.query('INSERT INTO business_branch(id, name) VALUES ($1, $2)', [
      branchId,
      'Another disposable branch',
    ]);
    await pool.query(
      'INSERT INTO business_department(id, branch_id, name) VALUES ($1, $2, $3)',
      [departmentId, branchId, 'POP N GO Minimart'],
    );
    await pool.query(
      'INSERT INTO business_till(id, department_id, name) VALUES ($1, $2, $3)',
      [tillId, departmentId, 'Another test till'],
    );
    const input = {
      sku: 'COMMON',
      name: 'Shared packaged item',
      unit: 'each',
      categoryId: null,
      price: '10.00',
      taxCode: null,
      barcodes: ['009900'],
      active: true,
    };
    const ids: string[] = [];
    for (const [department, till, quantity] of [
      [minimart, minimartTill, 5],
      [departmentId, tillId, 9],
    ] as const) {
      await businessScope.run(
        scope(manager.userId, department, till),
        async () => {
          await catalogue.createProduct(manager, { ...input, ...command() });
          const found = await catalogue.barcode('009900');
          ids.push(found.product.id);
          await inventory.opening(manager, {
            ...command(),
            productId: found.product.id,
            quantity,
          });
          const stock = (await inventory.stock('COMMON', '0')).stock;
          expect(stock).toHaveLength(1);
          expect(stock[0].quantityMinor).toBe(quantity);
          await expect(
            catalogue.createProduct(manager, { ...input, ...command() }),
          ).rejects.toThrow();
        },
      );
    }
    expect(ids[0]).not.toBe(ids[1]);
  });

  it('allows an MFA-verified supervisor to cancel their own held order without acting as a cashier', async () => {
    await businessScope.run(scope(supervisor.userId), async () => {
      const lines = [{ productId: food.id, unit: 'each', quantity: 1 }];
      await basket.save(supervisor, {
        requestId: randomUUID(),
        revision: 0,
        lines,
      });
      const actor = { ...supervisor, role: 'supervisor' as const };
      const held = await heldOrders.create(actor, {
        requestId: randomUUID(),
        lines,
        note: 'Disposable supervisor basket',
      });
      const result = await heldOrders.cancel(actor, held.id, {
        requestId: randomUUID(),
        revision: held.revision,
      });
      expect(result.status).toBe('cancelled');
    });
  });

  it('rejects unpaid and external-payment cash payouts without restoring stock', async () => {
    const stock = await pool.query(
      'SELECT quantity_minor FROM inventory_stock WHERE product_id = $1',
      [food.id],
    );
    for (const kind of [null, 'mpesa'] as const) {
      const saleId = randomUUID();
      await pool.query(
        `INSERT INTO sale(id, actor_id, total_minor, status, reason, department_id, till_id)
         VALUES ($1, $2, 2500, 'completed', 'Disposable return eligibility', $3, $4)`,
        [saleId, cashier.userId, minimart, minimartTill],
      );
      await pool.query(
        `INSERT INTO sale_line(id, sale_id, product_id, quantity_minor, unit_price_minor, line_total_minor)
         VALUES ($1, $2, $3, 1, 2500, 2500)`,
        [randomUUID(), saleId, food.id],
      );
      if (kind)
        await pool.query(
          `INSERT INTO sale_payment(id, sale_id, kind, amount_minor, status, reason)
         VALUES ($1, $2, $3, 2500, 'paid', 'Disposable provider fixture')`,
          [randomUUID(), saleId, kind],
        );
      await expect(
        businessScope.run(scope(cashier.userId), () =>
          returns.createReturn(cashier, {
            ...command(),
            saleId,
            lines: [{ productId: food.id, quantityMinor: 1 }],
          }),
        ),
      ).rejects.toThrow('fully cash-paid');
      expect(
        (
          await pool.query('SELECT id FROM sale_return WHERE sale_id = $1', [
            saleId,
          ])
        ).rowCount,
      ).toBe(0);
    }
    expect(
      (
        await pool.query(
          'SELECT quantity_minor FROM inventory_stock WHERE product_id = $1',
          [food.id],
        )
      ).rows,
    ).toEqual(stock.rows);
  });

  it('binds cash refunds to the selected open drawer, deduplicates payouts and closes with the correct balance', async () => {
    const shift = await businessScope.run(scope(cashier.userId), () =>
      shifts.currentShift(cashier.userId),
    );
    if (!shift.shift) throw new Error('Expected the test cashier open shift');
    const shiftId = shift.shift.shiftId;
    const cash = await pool.query<{ amount: string }>(
      `SELECT SUM(CASE WHEN kind IN ('opening', 'cash_in') THEN amount_minor ELSE -amount_minor END)::text AS amount
       FROM cash_movement WHERE shift_id = $1`,
      [shiftId],
    );
    const before = Number(cash.rows[0].amount);
    let saleId = '';
    await businessScope.run(scope(cashier.userId), async () => {
      const current = await basket.read(cashier);
      const lines = [{ productId: food.id, unit: 'each', quantity: 2 }];
      await basket.save(cashier, {
        requestId: randomUUID(),
        revision: current.revision,
        lines,
      });
      saleId = (
        await sales.checkout(cashier, {
          ...command(),
          lines,
          cashTenderedMinor: 5000,
        })
      ).saleId;
    });
    const request = {
      ...command(),
      saleId,
      lines: [{ productId: food.id, quantityMinor: 1 }],
    };
    const deniedScope = scope(cashier.userId, liquor, liquorTill);
    await expect(
      businessScope.run(deniedScope, () =>
        returns.createReturn(cashier, request),
      ),
    ).rejects.toThrow();
    await expect(
      businessScope.run(scope(second.userId), () =>
        returns.createReturn(second, request),
      ),
    ).rejects.toThrow('Open your shift');
    await businessScope.run(scope(cashier.userId), async () => {
      const [first, replay] = await Promise.all([
        returns.createReturn(cashier, request),
        returns.createReturn(cashier, request),
      ]);
      expect(first).toEqual(replay);
      expect(first.amountMinor).toBe(2500);
      expect(first.shiftId).toBe(shiftId);
      await expect(
        pool.query(
          `INSERT INTO cash_movement(id, shift_id, refund_id, kind, amount_minor, reason)
         VALUES ($1, $2, $3, 'cash_out', 2500, 'Duplicate test payout')`,
          [randomUUID(), shiftId, first.refundId],
        ),
      ).rejects.toMatchObject({ code: '23505' });
      await returns.createReturn(cashier, {
        ...request,
        requestId: randomUUID(),
      });
      const closed = await shifts.closeShift(
        { ...cashier, role: 'cashier' },
        {
          ...command(),
          shiftId,
          closingCashMinor: before,
        },
      );
      expect(closed.expectedCashMinor).toBe(before);
      expect(closed.varianceMinor).toBe(0);
      // A closed shift cannot cause a second payout; the original result is replayed.
      expect(await returns.createReturn(cashier, request)).toEqual(first);
    });
    const payouts = await pool.query<{ count: number; amount: string }>(
      `SELECT COUNT(*)::int AS count, SUM(cm.amount_minor)::text AS amount FROM cash_movement cm
       JOIN sale_refund r ON r.id = cm.refund_id WHERE r.sale_id = $1`,
      [saleId],
    );
    expect(payouts.rows[0]).toEqual({ count: 2, amount: '5000' });
  });
  it('preserves exact moving-average sale costs and restores original costs on partial returns after repricing stock', async () => {
    await businessScope.run(
      scope(manager.userId, liquor, liquorTill),
      async () => {
        await catalogue.createProduct(manager, {
          ...command(),
          sku: 'COST',
          name: 'Costed stock',
          unit: 'each',
          price: '10.00',
          active: true,
          categoryId: null,
          taxCode: null,
          barcodes: [],
        });
        const productId = (
          await pool.query<{ id: string }>(
            "SELECT id FROM catalogue_product WHERE sku = 'COST'",
          )
        ).rows[0].id;
        await inventory.opening(manager, {
          ...command(),
          productId,
          quantity: 3,
        });
        const opening = {
          ...command(),
          productId,
          expectedQuantityMinor: '3',
          totalValueMinor: '1000',
        };
        await expect(
          valuation.opening(manager, {
            ...opening,
            expectedQuantityMinor: '4',
          }),
        ).rejects.toThrow('Stock changed');
        const saved = await valuation.opening(manager, opening);
        expect(await valuation.opening(manager, opening)).toEqual(saved);
        await expect(
          valuation.opening(manager, { ...opening, requestId: randomUUID() }),
        ).rejects.toThrow('already valued');
        const supplierId = randomUUID();
        await pool.query(
          "INSERT INTO supplier(id, name) VALUES ($1, 'Cost test supplier')",
          [supplierId],
        );
        await purchases.receive(manager, {
          ...command(),
          supplierId,
          lines: [{ productId, quantity: 2, unitCostMinor: 500 }],
        });
        const state = async () =>
          (
            await pool.query<{
              quantity_minor: string;
              value_minor: string | null;
            }>(
              'SELECT quantity_minor::text, value_minor::text FROM stock_valuation WHERE product_id = $1',
              [productId],
            )
          ).rows[0];
        expect(await state()).toEqual({
          quantity_minor: '5',
          value_minor: '2000',
        });
        await shifts.openShift(
          { ...manager, role: 'manager' },
          { ...command(), openingCashMinor: 0 },
        );
        const lines = [{ productId, unit: 'each', quantity: 2 }];
        await basket.save(manager, {
          requestId: randomUUID(),
          revision: 0,
          lines,
        });
        const sale = await sales.checkout(manager, {
          ...command(),
          lines,
          cashTenderedMinor: 2000,
        });
        expect(await state()).toEqual({
          quantity_minor: '3',
          value_minor: '1200',
        });
        await purchases.receive(manager, {
          ...command(),
          supplierId,
          lines: [{ productId, quantity: 1, unitCostMinor: 1000 }],
        });
        expect(await state()).toEqual({
          quantity_minor: '4',
          value_minor: '2200',
        });
        await returns.createReturn(manager, {
          ...command(),
          saleId: sale.saleId,
          lines: [{ productId, quantityMinor: 1 }],
        });
        expect(await state()).toEqual({
          quantity_minor: '5',
          value_minor: '2600',
        });
        const day = new Date(Date.now() + 3 * 3600000)
          .toISOString()
          .slice(0, 10);
        const report = (await valuation.position(day)).departments.find(
          (d) => d.departmentId === liquor,
        );
        expect(report).toMatchObject({
          netSalesMinor: '1000',
          netCostMinor: '400',
          grossProfitMinor: '600',
          missingCostLines: 0,
        });
        await returns.createReturn(manager, {
          ...command(),
          saleId: sale.saleId,
          lines: [{ productId, quantityMinor: 1 }],
        });
        expect(await state()).toEqual({
          quantity_minor: '6',
          value_minor: '3000',
        });
        const source = await pool.query<{ value: string }>(
          'SELECT c.value_delta_minor::text AS value FROM stock_cost_entry c JOIN sale_line sl ON sl.id = c.sale_line_id WHERE sl.sale_id = $1',
          [sale.saleId],
        );
        expect(source.rows[0].value).toBe('-800');
        await inventory.adjust(manager, {
          ...command(),
          productId,
          quantity: -1,
        });
        expect(await state()).toEqual({
          quantity_minor: '5',
          value_minor: '2500',
        });
        await inventory.adjust(manager, {
          ...command(),
          productId,
          quantity: 2,
        });
        expect(await state()).toEqual({
          quantity_minor: '7',
          value_minor: '3500',
        });
        // Unpriced receipts cannot silently acquire a zero cost.
        await inventory.receive(manager, {
          ...command(),
          productId,
          quantity: 1,
        });
        expect(await state()).toEqual({
          quantity_minor: '8',
          value_minor: null,
        });
        await valuation.opening(manager, {
          ...command(),
          productId,
          expectedQuantityMinor: '8',
          totalValueMinor: '1',
        });
        await inventory.adjust(manager, {
          ...command(),
          productId,
          quantity: -3,
        });
        expect(await state()).toEqual({
          quantity_minor: '5',
          value_minor: '1',
        });
        await inventory.adjust(manager, {
          ...command(),
          productId,
          quantity: -3,
        });
        expect(await state()).toEqual({
          quantity_minor: '2',
          value_minor: '0',
        });
        await inventory.adjust(manager, {
          ...command(),
          productId,
          quantity: -2,
        });
        expect(await state()).toEqual({
          quantity_minor: '0',
          value_minor: '0',
        });
        await expect(
          pool.query(
            'UPDATE stock_cost_entry SET value_delta_minor = 0 WHERE sale_line_id IS NOT NULL',
          ),
        ).rejects.toThrow('append-only');
        await expect(
          businessScope.run(scope(cashier.userId, liquor, liquorTill), () =>
            valuation.opening(cashier, opening),
          ),
        ).rejects.toThrow();
      },
    );
  });
});
