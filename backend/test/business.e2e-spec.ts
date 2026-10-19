import { ShiftsService } from '../src/shifts/shifts.service.js';
import { Test } from '@nestjs/testing';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AUTH } from '../src/identity/auth.js';
import { AUTH_CONFIG } from '../src/identity/auth.config.js';
import { StaffGuard } from '../src/identity/staff.guard.js';
import { DatabaseService } from '../src/database/database.service.js';
import { BusinessController } from '../src/business/business.controller.js';
import { BusinessService } from '../src/business/business.service.js';
import { BusinessInterceptor } from '../src/business/business.interceptor.js';
import { CatalogueController } from '../src/catalogue/catalogue.controller.js';
import { CatalogueService } from '../src/catalogue/catalogue.service.js';
import { CatalogueImportService } from '../src/catalogue/catalogue-import.service.js';
import { CatalogueWrites } from '../src/catalogue/catalogue-writes.js';
import { ProductPhotoService } from '../src/catalogue/product-photo.service.js';
import { ValuationController } from '../src/inventory/valuation.controller.js';
import { ValuationService } from '../src/inventory/valuation.service.js';

describe('business scope and supervisor HTTP boundaries', () => {
  let app: INestApplication<App>;
  const home = '11111111-1111-4111-8111-111111111111';
  const other = '22222222-2222-4222-8222-222222222222';
  const origin = 'http://localhost:5173';
  const getSession = vi.fn(),
    query = vi.fn(),
    execute = vi.fn(),
    createBranch = vi.fn();
  const session = (role: string, proof = true) => ({
    user: {
      id: 'staff',
      role,
      disabled: false,
      emailVerified: true,
      twoFactorEnabled: role !== 'cashier',
    },
    session: { id: 'session', mfaVerified: proof, lastActivityAt: new Date() },
  });
  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      controllers: [
        BusinessController,
        CatalogueController,
        ValuationController,
      ],
      providers: [
        {
          provide: ValuationService,
          useValue: {
            position: async () => ({ departments: [], products: [] }),
            opening: async () => ({ saved: true }),
          },
        },
        { provide: ShiftsService, useValue: { closeShift: vi.fn() } },
        CatalogueService,
        CatalogueImportService,
        ProductPhotoService,
        {
          provide: BusinessService,
          useValue: {
            createBranch,
            configuration: () => ({ departments: [] }),
          },
        },
        { provide: DatabaseService, useValue: { connectionPool: { query } } },
        { provide: CatalogueWrites, useValue: { execute } },
        { provide: AUTH, useValue: { api: { getSession } } },
        { provide: AUTH_CONFIG, useValue: { baseURL: origin } },
        { provide: APP_GUARD, useClass: StaffGuard },
        { provide: APP_INTERCEPTOR, useClass: BusinessInterceptor },
      ],
    }).compile();
    app = fixture.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    vi.resetAllMocks();
    getSession.mockResolvedValue(session('cashier'));
    query.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('WHERE user_id = $1 AND home'))
        return { rows: [{ department_id: home }], rowCount: 1 };
      if (sql.includes('FROM business_department'))
        return {
          rows: params[0] === home ? [{ id: home }] : [],
          rowCount: params[0] === home ? 1 : 0,
        };
      return { rows: [], rowCount: 0 };
    });
    execute.mockResolvedValue({ product: { id: home } });
  });
  it('keeps stock costs and opening valuation manager-only with MFA', async () => {
    for (const role of ['cashier', 'supervisor']) {
      getSession.mockResolvedValue(session(role));
      await request(app.getHttpServer())
        .get('/api/inventory/valuation?day=2026-10-17')
        .expect(403);
      await request(app.getHttpServer())
        .post('/api/inventory/valuation/opening')
        .set('Origin', origin)
        .send({})
        .expect(403);
    }
    getSession.mockResolvedValue(session('manager', false));
    await request(app.getHttpServer())
      .get('/api/inventory/valuation?day=2026-10-17')
      .expect(403);
    getSession.mockResolvedValue(session('manager'));
    await request(app.getHttpServer())
      .get('/api/inventory/valuation?day=2026-10-17')
      .expect(200);
    await request(app.getHttpServer())
      .post('/api/inventory/valuation/opening')
      .set('Origin', origin)
      .set('X-Paygo-Department', home)
      .send({})
      .expect(201);
  });
  it('defaults a cashier to the home department and rejects a forged selector header', async () => {
    await request(app.getHttpServer())
      .get('/api/catalogue/products')
      .expect(200);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes(`p.department_id = '${home}'`),
      ),
    ).toBe(true);
    query.mockClear();
    await request(app.getHttpServer())
      .get('/api/catalogue/products')
      .set('X-Paygo-Department', other)
      .expect(403);
    expect(
      query.mock.calls.some(([sql]) =>
        String(sql).includes('FROM catalogue_product p'),
      ),
    ).toBe(false);
  });
  it('rejects malformed scope and tills that are not in the selected department', async () => {
    await request(app.getHttpServer())
      .get('/api/catalogue/products')
      .set('X-Paygo-Department', 'not-a-uuid')
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/catalogue/products')
      .set('X-Paygo-Department', home)
      .set('X-Paygo-Till', other)
      .expect(400);
  });
  it('allows supervisor product creation after MFA but denies maintenance and business settings', async () => {
    const body = {
      requestId: other,
      reason: 'New shelf item',
      sku: 'SOAP',
      name: 'Soap',
      categoryId: null,
      unit: 'each',
      price: '25.00',
      taxCode: null,
      barcodes: [],
      active: true,
    };
    getSession.mockResolvedValue(session('supervisor', false));
    await request(app.getHttpServer())
      .post('/api/catalogue/products')
      .set('Origin', origin)
      .send(body)
      .expect(403);
    getSession.mockResolvedValue(session('supervisor'));
    await request(app.getHttpServer())
      .post('/api/catalogue/products')
      .set('Origin', origin)
      .send(body)
      .expect(201);
    expect(execute).toHaveBeenCalledOnce();
    await request(app.getHttpServer())
      .patch(`/api/catalogue/products/${home}`)
      .set('Origin', origin)
      .send({ ...body, revision: 1 })
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/business/branches')
      .set('Origin', origin)
      .send({ name: 'Unauthorized' })
      .expect(403);
    expect(createBranch).not.toHaveBeenCalled();
  });
});
