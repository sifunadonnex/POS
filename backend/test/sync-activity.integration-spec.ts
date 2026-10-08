import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { runner } from 'node-pg-migrate';
import { Pool } from 'pg';
import { parseEnvironment } from '../src/config/environment.js';
import { databaseOptions } from '../src/database/database.options.js';
import { ReportsService } from '../src/reports/reports.service.js';
import { EdgeSyncService } from '../src/sync/edge-sync.service.js';
import { syncSecretDigest } from '../src/store/cutover-ticket.js';
import { createSyncSignature } from '../src/sync/sync-auth.js';
import { HostedSyncService } from '../src/sync/hosted-sync.service.js';

describe('synchronized refunds and stock on disposable PostgreSQL', () => {
  const storeId = randomUUID();
  const productId = randomUUID();
  const cashierId = randomUUID();
  const saleId = randomUUID();
  const returnId = randomUUID();
  const refundId = randomUUID();
  const hostedSupplierId = randomUUID();
  const hostedReceiptId = randomUUID();
  const secret = 's'.repeat(48);
  const schemas = [
    `activity_edge_${randomUUID().replaceAll('-', '')}`,
    `activity_hosted_${randomUUID().replaceAll('-', '')}`,
  ];
  let edge: Pool;
  let hosted: Pool;
  let service: HostedSyncService;
  let reports: ReportsService;
  let edgeReconciliation: EdgeSyncService;
  let hostedReconciliation: EdgeSyncService;

  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url || !new URL(url).pathname.endsWith('_test'))
      throw new Error('Explicit TEST_DATABASE_URL ending in _test is required');
    const base = {
      DATABASE_URL: url,
      DATABASE_TLS: process.env.TEST_DATABASE_TLS ?? 'verify',
      NODE_ENV: 'test',
    };
    const edgeConfig = parseEnvironment({
      ...base,
      PAYGO_RUNTIME_MODE: 'edge',
      PAYGO_STORE_ID: storeId,
    });
    const hostedConfig = parseEnvironment({
      ...base,
      PAYGO_SYNC_ENABLED: 'true',
      PAYGO_SYNC_STORE_ID: storeId,
      PAYGO_SYNC_SECRET: secret,
    });
    edge = new Pool({
      ...databaseOptions(edgeConfig),
      options: `-c search_path=${schemas[0]}`,
    });
    hosted = new Pool({
      ...databaseOptions(hostedConfig),
      options: `-c search_path=${schemas[1]}`,
    });
    for (const [index, pool] of [edge, hosted].entries()) {
      await pool.query(`CREATE SCHEMA "${schemas[index]}"`);
      const client = await pool.connect();
      try {
        await runner({
          dbClient: client,
          dir: fileURLToPath(new URL('../migrations/', import.meta.url)),
          schema: schemas[index],
          migrationsSchema: schemas[index],
          migrationsTable: 'pgmigrations',
          direction: 'up',
          singleTransaction: true,
          log: () => undefined,
        });
      } finally {
        client.release();
      }
    }
    service = new HostedSyncService(hostedConfig, {
      connectionPool: hosted,
    } as never);
    reports = new ReportsService(hostedConfig, {
      connectionPool: hosted,
    } as never);
    edgeReconciliation = new EdgeSyncService(edgeConfig, {
      connectionPool: edge,
    } as never);
    hostedReconciliation = new EdgeSyncService(hostedConfig, {
      connectionPool: hosted,
    } as never);
    await edge.query(
      `INSERT INTO "user" (id,name,email,role,"emailVerified")
       VALUES ($1,'Amina Cashier','amina@example.test','cashier',true)`,
      [cashierId],
    );
    for (const pool of [edge, hosted]) {
      await pool.query(
        `INSERT INTO catalogue_product
         (id,sku,name,unit,price_minor,active,revision)
         VALUES ($1,'RICE','Rice','each',100,true,1)`,
        [productId],
      );
    }
    await edge.query(
      `INSERT INTO store_bootstrap_state
       (store_id,runtime_mode,checkout_authority,generation,
        configuration_version,configuration_digest,last_roster_check_at)
       VALUES ($1,'edge','local',1,1,$2,now())`,
      [storeId, 'a'.repeat(64)],
    );
    await hosted.query(
      `INSERT INTO "user" (id,name,email,role,"emailVerified")
       VALUES ($1,'Amina Cashier','hosted-amina@example.test','cashier',true)`,
      [cashierId],
    );
    await hosted.query('INSERT INTO supplier (id,name) VALUES ($1,$2)', [
      hostedSupplierId,
      'Hosted Supplier',
    ]);
    await hosted.query(
      `INSERT INTO purchase_receipt
      (id,supplier_id,actor_id,reason,total_minor,status)
      VALUES ($1,$2,$3,'Before cutover',400,'received')`,
      [hostedReceiptId, hostedSupplierId, cashierId],
    );
    const hostedLineId = randomUUID();
    await hosted.query(
      `INSERT INTO purchase_receipt_line
      (id,receipt_id,product_id,quantity_minor,unit_cost_minor,line_total_minor)
      VALUES ($1,$2,$3,4,100,400)`,
      [hostedLineId, hostedReceiptId, productId],
    );
    const hostedReturnId = randomUUID();
    await hosted.query(
      `INSERT INTO purchase_return
      (id,receipt_id,actor_id,reason,total_minor,status)
      VALUES ($1,$2,$3,'Before cutover return',100,'returned')`,
      [hostedReturnId, hostedReceiptId, cashierId],
    );
    await hosted.query(
      `INSERT INTO purchase_return_line
      (id,return_id,receipt_line_id,product_id,quantity_minor,
       unit_cost_minor,line_total_minor)
      VALUES ($1,$2,$3,$4,1,100,100)`,
      [randomUUID(), hostedReturnId, hostedLineId, productId],
    );
    await hosted.query(
      `INSERT INTO store_bootstrap_state
       (store_id,runtime_mode,checkout_authority,generation,
        configuration_version,configuration_digest,cutover_request_id,
        cutover_at,sync_secret_digest)
       VALUES ($1,'hosted','local',1,1,$2,$3,now(),$4)`,
      [storeId, 'a'.repeat(64), randomUUID(), syncSecretDigest(secret)],
    );
  });

  afterAll(async () => {
    for (const [index, pool] of [edge, hosted].entries()) {
      if (pool) {
        await pool.query(`DROP SCHEMA "${schemas[index]}" CASCADE`);
        await pool.end();
      }
    }
  });

  async function deliver(eventId: string, value: unknown) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    return service.ingest(
      {
        storeId,
        eventId,
        timestamp,
        generation: '1',
        signature: createSyncSignature(
          secret,
          storeId,
          eventId,
          timestamp,
          value,
          1,
        ),
      },
      value,
    );
  }

  it('writes each stock kind and paid refund to the outbox in its source transaction', async () => {
    const movements = [
      { kind: 'opening', delta: 5, after: 5 },
      { kind: 'sale', delta: -2, after: 3 },
      { kind: 'return', delta: 1, after: 4 },
      { kind: 'receive', delta: 3, after: 7 },
      { kind: 'return', delta: -1, after: 6 },
      { kind: 'adjustment', delta: -1, after: 5 },
      { kind: 'stocktake', delta: 1, after: 6 },
    ];
    for (const movement of movements) {
      await edge.query(
        `INSERT INTO inventory_movement
         (id,product_id,kind,delta_minor,quantity_after_minor,actor_id,reason)
         VALUES ($1,$2,$3,$4,$5,$6,'Integration movement')`,
        [
          randomUUID(),
          productId,
          movement.kind,
          movement.delta,
          movement.after,
          cashierId,
        ],
      );
    }
    const stockEvents = await edge.query<{
      id: string;
      payload: { deltaMinor: number; productName: string };
    }>(
      "SELECT id,payload FROM sync_outbox WHERE event_type = 'stock_movement.recorded'",
    );
    expect(stockEvents.rowCount).toBe(7);
    expect(
      stockEvents.rows
        .map((row) => row.payload.deltaMinor)
        .sort((a, b) => a - b),
    ).toEqual([-2, -1, -1, 1, 1, 3, 5]);
    expect(
      stockEvents.rows.every((row) => row.payload.productName === 'Rice'),
    ).toBe(true);

    const client = await edge.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO inventory_movement
         (id,product_id,kind,delta_minor,quantity_after_minor,actor_id,reason)
         VALUES ($1,$2,'adjustment',1,7,$3,'Rolled back')`,
        [randomUUID(), productId, cashierId],
      );
      await client.query('ROLLBACK');
    } finally {
      client.release();
    }
    expect(
      (
        await edge.query(
          "SELECT id FROM sync_outbox WHERE event_type = 'stock_movement.recorded'",
        )
      ).rowCount,
    ).toBe(7);

    await edge.query(
      `INSERT INTO sale (id,actor_id,total_minor,status,reason)
       VALUES ($1,$2,200,'completed','Test sale')`,
      [saleId, cashierId],
    );
    await edge.query(
      `INSERT INTO sale_return (id,sale_id,actor_id,reason,total_minor,status)
       VALUES ($1,$2,$3,'Customer return',100,'completed')`,
      [returnId, saleId, cashierId],
    );
    await edge.query(
      `INSERT INTO sale_refund
       (id,sale_id,return_id,amount_minor,status,reason)
       VALUES ($1,$2,$3,100,'paid','Customer return')`,
      [refundId, saleId, returnId],
    );
    const refund = await edge.query<{
      payload: { cashierName: string; amountMinor: number };
    }>("SELECT payload FROM sync_outbox WHERE event_type = 'sale_refund.paid'");
    expect(refund.rows[0].payload).toMatchObject({
      cashierName: 'Amina Cashier',
      amountMinor: 100,
    });
  });

  it('projects signed events once and reports exact refunds and stock', async () => {
    const occurredAt = new Date().toISOString();
    const saleEventId = randomUUID();
    const salePayload = {
      eventId: saleEventId,
      storeId,
      eventType: 'cash_sale.completed',
      schemaVersion: 2,
      requestId: randomUUID(),
      saleId,
      cashierId,
      cashierName: 'Amina Cashier',
      shiftId: randomUUID(),
      occurredAt,
      totalMinor: 200,
      lines: [
        {
          productId,
          name: 'Rice',
          sku: 'RICE',
          unit: 'each',
          quantity: 2,
          priceMinor: 100,
          lineTotalMinor: 200,
        },
      ],
      payment: {
        paymentId: randomUUID(),
        amountMinor: 200,
        tenderedMinor: 200,
        changeMinor: 0,
      },
    };
    const saleEnvelope = {
      eventId: saleEventId,
      storeId,
      eventType: 'cash_sale.completed',
      aggregateId: saleId,
      schemaVersion: 2,
      occurredAt,
      payload: salePayload,
    };
    expect((await deliver(saleEventId, saleEnvelope)).status).toBe('accepted');
    const edgeEvents = await edge.query<{
      id: string;
      store_id: string;
      event_type: string;
      aggregate_id: string;
      schema_version: number;
      payload: Record<string, unknown>;
    }>('SELECT * FROM sync_outbox ORDER BY created_at,id');
    for (const row of edgeEvents.rows) {
      const envelope = {
        eventId: row.id,
        storeId: row.store_id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
        schemaVersion: row.schema_version,
        occurredAt: row.payload.occurredAt,
        payload: row.payload,
      };
      expect((await deliver(row.id, envelope)).status).toBe('accepted');
      expect((await deliver(row.id, envelope)).status).toBe('duplicate');
    }
    expect((await hosted.query('SELECT id FROM sync_inbox')).rowCount).toBe(9);
    expect(
      (await hosted.query('SELECT event_id FROM sync_refund_projection'))
        .rowCount,
    ).toBe(1);
    expect(
      (
        await hosted.query(
          'SELECT event_id FROM sync_stock_movement_projection',
        )
      ).rowCount,
    ).toBe(7);
    const reportDay = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Africa/Nairobi',
    });
    const sales = await reports.salesInsights(
      reportDay,
      reportDay,
      'edge',
      storeId,
    );
    expect(sales.summary).toMatchObject({
      saleCount: 1,
      grossSalesMinor: 200,
      refundCount: 1,
      refundMinor: 100,
      netSalesMinor: 100,
    });
    expect(sales.coverage.synchronizedReturns).toBe('available');
    expect(sales.reportingLag).toMatchObject({
      status: 'current',
      receivedEvents: 9,
      projectedEvents: 9,
    });
    const stock = await reports.stockPosition();
    expect(stock).toMatchObject({
      source: 'edge',
      storeId,
      products: [{ productId, quantityMinor: 6, movementCount: 7 }],
    });
    expect(await hostedReconciliation.reconciliation()).toMatchObject({
      receivedRefundMinor: '100',
      projectedRefundMinor: '100',
      refundVarianceMinor: '0',
      receivedStockDeltaMinor: '6',
      projectedStockDeltaMinor: '6',
      stockDeltaVarianceMinor: '0',
    });
    expect(await edgeReconciliation.reconciliation()).toMatchObject({
      enqueuedRefundMinor: '100',
      pendingRefundMinor: '100',
      enqueuedStockDeltaMinor: '6',
      pendingStockDeltaMinor: '6',
    });
    expect(
      (await hosted.query('SELECT count(*)::int AS count FROM inventory_stock'))
        .rows[0].count,
    ).toBe(0);
  });

  it('rejects tampering and conflicting replay without accepting another event', async () => {
    const original = (
      await edge.query<{ id: string; payload: Record<string, unknown> }>(
        "SELECT id,payload FROM sync_outbox WHERE event_type = 'sale_refund.paid'",
      )
    ).rows[0];
    const value = {
      eventId: original.id,
      storeId,
      eventType: 'sale_refund.paid',
      aggregateId: refundId,
      schemaVersion: 1,
      occurredAt: original.payload.occurredAt,
      payload: { ...original.payload, amountMinor: -1 },
    };
    await expect(deliver(original.id, value)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    const valid = {
      ...value,
      payload: { ...original.payload, amountMinor: 99 },
    };
    await expect(deliver(original.id, valid)).rejects.toBeInstanceOf(
      ConflictException,
    );
    const freshId = randomUUID();
    const forged = {
      ...value,
      eventId: freshId,
      aggregateId: freshId,
      payload: {
        ...original.payload,
        eventId: freshId,
        refundId: freshId,
        amountMinor: 100,
      },
    };
    const timestamp = String(Math.floor(Date.now() / 1000));
    await expect(
      service.ingest(
        {
          storeId,
          eventId: freshId,
          timestamp,
          generation: '1',
          signature: 'a'.repeat(64),
        },
        forged,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect((await hosted.query('SELECT id FROM sync_inbox')).rowCount).toBe(9);
  });

  it('atomically records supplier and zero-delta count documents, then projects signed replays', async () => {
    const supplierId = randomUUID();
    const receiptId = randomUUID();
    const receiptLineId = randomUUID();
    const supplierReturnId = randomUUID();
    const stocktakeId = randomUUID();
    await edge.query('INSERT INTO supplier (id,name) VALUES ($1,$2)', [
      supplierId,
      'Market Foods',
    ]);

    const rollbackId = randomUUID();
    const rollback = await edge.connect();
    try {
      await rollback.query('BEGIN');
      await rollback.query(
        `INSERT INTO purchase_receipt
        (id,supplier_id,actor_id,reason,total_minor,status)
        VALUES ($1,$2,$3,'Rolled back receipt',0,'received')`,
        [rollbackId, supplierId, cashierId],
      );
      await rollback.query('ROLLBACK');
    } finally {
      rollback.release();
    }
    expect(
      (
        await edge.query('SELECT id FROM sync_outbox WHERE id = $1', [
          rollbackId,
        ])
      ).rowCount,
    ).toBe(0);

    const incompleteId = randomUUID();
    await expect(
      edge.query(
        `INSERT INTO purchase_receipt
      (id,supplier_id,actor_id,reason,total_minor,status)
      VALUES ($1,$2,$3,'No lines allowed',100,'received')`,
        [incompleteId, supplierId, cashierId],
      ),
    ).rejects.toThrow('Purchase document lines do not match total');
    expect(
      (
        await edge.query('SELECT id FROM purchase_receipt WHERE id = $1', [
          incompleteId,
        ])
      ).rowCount,
    ).toBe(0);

    const receipt = await edge.connect();
    try {
      await receipt.query('BEGIN');
      await receipt.query(
        `INSERT INTO purchase_receipt
        (id,supplier_id,actor_id,reason,total_minor,status)
        VALUES ($1,$2,$3,'Supplier delivery',300,'received')`,
        [receiptId, supplierId, cashierId],
      );
      await receipt.query(
        `INSERT INTO purchase_receipt_line
        (id,receipt_id,product_id,quantity_minor,unit_cost_minor,line_total_minor)
        VALUES ($1,$2,$3,3,100,300)`,
        [receiptLineId, receiptId, productId],
      );
      await receipt.query('COMMIT');
    } finally {
      receipt.release();
    }

    const returned = await edge.connect();
    try {
      await returned.query('BEGIN');
      await returned.query(
        `INSERT INTO purchase_return
        (id,receipt_id,actor_id,reason,total_minor,status)
        VALUES ($1,$2,$3,'Damaged delivery',100,'returned')`,
        [supplierReturnId, receiptId, cashierId],
      );
      await returned.query(
        `INSERT INTO purchase_return_line
        (id,return_id,receipt_line_id,product_id,quantity_minor,
         unit_cost_minor,line_total_minor)
        VALUES ($1,$2,$3,$4,1,100,100)`,
        [randomUUID(), supplierReturnId, receiptLineId, productId],
      );
      await returned.query('COMMIT');
    } finally {
      returned.release();
    }
    await edge.query(
      `INSERT INTO stocktake
      (id,product_id,counted_quantity_minor,previous_quantity_minor,
       delta_minor,actor_id,reason)
      VALUES ($1,$2,6,6,0,$3,'Verified shelf count')`,
      [stocktakeId, productId, cashierId],
    );
    await edge.query(
      `INSERT INTO inventory_movement
      (id,product_id,kind,delta_minor,quantity_after_minor,actor_id,reason)
      VALUES ($1,$2,'stocktake',0,6,$3,'Verified shelf count')`,
      [randomUUID(), productId, cashierId],
    );

    const documents = await edge.query<{
      id: string;
      store_id: string;
      event_type: string;
      aggregate_id: string;
      schema_version: number;
      payload: Record<string, unknown>;
    }>(`SELECT id,store_id,event_type,aggregate_id,schema_version,payload
      FROM sync_outbox WHERE event_type IN
      ('purchase_receipt.received','purchase_return.returned',
       'stocktake.counted') OR
      (event_type = 'stock_movement.recorded' AND payload->>'deltaMinor' = '0')
      ORDER BY created_at,id`);
    expect(documents.rowCount).toBe(4);
    expect(
      documents.rows.find((row) => row.id === receiptId)?.payload,
    ).toMatchObject({
      supplierName: 'Market Foods',
      totalMinor: 300,
      lines: [{ productName: 'Rice', lineTotalMinor: 300 }],
    });
    for (const row of documents.rows) {
      const envelope = {
        eventId: row.id,
        storeId: row.store_id,
        eventType: row.event_type,
        aggregateId: row.aggregate_id,
        schemaVersion: row.schema_version,
        occurredAt: row.payload.occurredAt,
        payload: row.payload,
      };
      expect((await deliver(row.id, envelope)).status).toBe('accepted');
      expect((await deliver(row.id, envelope)).status).toBe('duplicate');
    }
    expect(
      (
        await hosted.query(
          'SELECT event_id FROM sync_operation_document_projection',
        )
      ).rowCount,
    ).toBe(3);
    expect(
      (await hosted.query('SELECT id FROM purchase_receipt')).rowCount,
    ).toBe(1);
    const reportDay = new Date().toLocaleDateString('en-CA', {
      timeZone: 'Africa/Nairobi',
    });
    const report = await reports.operationDocuments(reportDay, reportDay);
    expect(report).toMatchObject({ source: 'edge', storeId, total: 3 });
    await expect(
      reports.operationDocuments(reportDay, reportDay, '0'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(
      (await reports.operationDocuments(reportDay, reportDay, '2')).documents,
    ).toEqual([]);
    expect(report.documents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ documentId: receiptId, totalMinor: 300 }),
        expect.objectContaining({
          documentId: supplierReturnId,
          totalMinor: 100,
          receiptId,
        }),
        expect.objectContaining({
          documentId: stocktakeId,
          deltaMinor: 0,
          countedQuantityMinor: 6,
        }),
      ]),
    );
    const purchases = await reports.purchaseReconciliation(
      reportDay,
      reportDay,
    );
    expect(purchases.summary).toMatchObject({
      receiptCount: 2,
      receivedTotalMinor: 700,
      returnCount: 2,
      returnedTotalMinor: 200,
      netPurchasesMinor: 500,
      supplierCount: 2,
    });
    expect(purchases.suppliers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'edge',
          supplierName: 'Market Foods',
          netPurchasesMinor: 200,
        }),
      ]),
    );
    expect(purchases.receipts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: 'operational',
          receiptId: hostedReceiptId,
          netTotalMinor: 300,
        }),
        expect.objectContaining({
          source: 'edge',
          receiptId,
          returnedTotalMinor: 100,
          netTotalMinor: 200,
        }),
      ]),
    );
    expect(await hostedReconciliation.reconciliation()).toMatchObject({
      receivedEvents: 13,
      projectedEvents: 13,
      unprojectedEvents: 0,
    });
    const receiptEvent = documents.rows.find((row) => row.id === receiptId)!;
    await expect(
      deliver(receiptEvent.id, {
        eventId: receiptEvent.id,
        storeId,
        eventType: receiptEvent.event_type,
        aggregateId: receiptEvent.aggregate_id,
        schemaVersion: 1,
        occurredAt: receiptEvent.payload.occurredAt,
        payload: { ...receiptEvent.payload, totalMinor: 301 },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
