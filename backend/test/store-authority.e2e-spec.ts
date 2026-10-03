import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CatalogueController } from '../src/catalogue/catalogue.controller.js';
import { CatalogueImportService } from '../src/catalogue/catalogue-import.service.js';
import { CatalogueService } from '../src/catalogue/catalogue.service.js';
import { parseEnvironment, APP_CONFIG } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';
import { StaffAdminController } from '../src/identity/staff-admin.controller.js';
import { StaffAdminService } from '../src/identity/staff-admin.service.js';
import { InventoryController } from '../src/inventory/inventory.controller.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { SalesLookupService } from '../src/sales/sales-lookup.service.js';
import { SalesController } from '../src/sales/sales.controller.js';
import { SalesService } from '../src/sales/sales.service.js';
import { SuspendedOrdersService } from '../src/sales/suspended-orders.service.js';
import { StoreAuthorityGuard } from '../src/store/store-authority.guard.js';
import { StoreAuthorityService } from '../src/store/store-authority.service.js';

const storeId = '11111111-1111-4111-8111-111111111111';

async function application(mode: 'edge' | 'hosted', localAuthority: boolean) {
  const query = vi.fn().mockResolvedValue({
    rows: localAuthority
      ? [{ runtime_mode: 'hosted', checkout_authority: 'local' }]
      : [],
  });
  const createProduct = vi.fn().mockResolvedValue({ id: 'product' });
  const createStaff = vi.fn().mockResolvedValue({ id: 'staff' });
  const checkout = vi.fn().mockResolvedValue({ saleId: 'sale' });
  const opening = vi.fn().mockResolvedValue({ productId: 'product' });
  const config = parseEnvironment({
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:5432/paygo_test',
    DATABASE_TLS: 'disable',
    NODE_ENV: 'test',
    PAYGO_RUNTIME_MODE: mode,
    PAYGO_STORE_ID: mode === 'edge' ? storeId : undefined,
  });
  const fixture = await Test.createTestingModule({
    controllers: [
      CatalogueController,
      StaffAdminController,
      SalesController,
      InventoryController,
    ],
    providers: [
      { provide: APP_CONFIG, useValue: config },
      { provide: DatabaseService, useValue: { connectionPool: { query } } },
      StoreAuthorityService,
      { provide: APP_GUARD, useClass: StoreAuthorityGuard },
      {
        provide: CatalogueService,
        useValue: { createProduct, categories: () => [] },
      },
      { provide: CatalogueImportService, useValue: { import: vi.fn() } },
      { provide: StaffAdminService, useValue: { create: createStaff } },
      { provide: SalesService, useValue: { checkout } },
      { provide: SalesLookupService, useValue: { listSales: () => [] } },
      { provide: SuspendedOrdersService, useValue: { list: () => [] } },
      { provide: InventoryService, useValue: { opening } },
    ],
  }).compile();
  const app = fixture.createNestApplication();
  await app.init();
  return { app, query, createProduct, createStaff, checkout, opening };
}

describe('store authority HTTP guards', () => {
  let edge: Awaited<ReturnType<typeof application>>;
  let hosted: Awaited<ReturnType<typeof application>>;

  beforeAll(async () => {
    edge = await application('edge', false);
    hosted = await application('hosted', true);
  });

  afterAll(async () => {
    await edge.app.close();
    await hosted.app.close();
  });

  it('refuses edge staff and catalogue mutations before handlers run', async () => {
    await request(edge.app.getHttpServer())
      .post('/api/identity/staff')
      .send({})
      .expect(403);
    await request(edge.app.getHttpServer())
      .post('/api/catalogue/products')
      .send({})
      .expect(403);
    expect(edge.createStaff).not.toHaveBeenCalled();
    expect(edge.createProduct).not.toHaveBeenCalled();
    expect(edge.query).not.toHaveBeenCalled();
    await request(edge.app.getHttpServer())
      .get('/api/catalogue/categories')
      .expect(200);
  });

  it('refuses hosted checkout and stock mutations after cutover', async () => {
    await request(hosted.app.getHttpServer())
      .post('/api/sales/checkout')
      .send({})
      .expect(409);
    await request(hosted.app.getHttpServer())
      .post('/api/inventory/opening')
      .send({})
      .expect(409);
    expect(hosted.checkout).not.toHaveBeenCalled();
    expect(hosted.opening).not.toHaveBeenCalled();
    expect(hosted.query).toHaveBeenCalledTimes(2);
    await request(hosted.app.getHttpServer())
      .get('/api/catalogue/categories')
      .expect(200);
  });
});
