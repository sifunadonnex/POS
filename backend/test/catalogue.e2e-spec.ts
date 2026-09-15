import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AUTH } from '../src/identity/auth.js';
import { AUTH_CONFIG } from '../src/identity/auth.config.js';
import { StaffGuard } from '../src/identity/staff.guard.js';
import { DatabaseService } from '../src/database/database.service.js';
import { CatalogueController } from '../src/catalogue/catalogue.controller.js';
import { CatalogueService } from '../src/catalogue/catalogue.service.js';
import { CatalogueImportService } from '../src/catalogue/catalogue-import.service.js';
import { CatalogueWrites } from '../src/catalogue/catalogue-writes.js';

describe('catalogue HTTP contracts without PostgreSQL', () => {
  let app: INestApplication<App>;
  const query = vi.fn(),
    getSession = vi.fn(),
    execute = vi.fn();
  const origin = 'http://localhost:5173';
  const productId = 'b292f92a-6f3a-4511-972f-d81ecba9b38c';
  const body = {
    requestId: '7835ae0b-ed56-489d-a8cd-c05b5e35897f',
    reason: 'Initial catalogue',
    sku: 'rice',
    name: 'Rice',
    unit: 'kg',
    categoryId: null,
    price: '180.05',
    barcodes: ['00123'],
    taxCode: null,
    active: true,
  };
  function session(role = 'manager', mfaVerified = true) {
    return {
      user: {
        id: 'manager-id',
        role,
        disabled: false,
        emailVerified: true,
        twoFactorEnabled: role === 'manager',
      },
      session: { id: 'session-id', mfaVerified, lastActivityAt: new Date() },
    };
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CatalogueController],
      providers: [
        CatalogueService,
        CatalogueImportService,
        { provide: CatalogueWrites, useValue: { execute } },
        { provide: DatabaseService, useValue: { connectionPool: { query } } },
        { provide: AUTH, useValue: { api: { getSession } } },
        { provide: AUTH_CONFIG, useValue: { baseURL: origin } },
        { provide: APP_GUARD, useClass: StaffGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    vi.resetAllMocks();
    query.mockResolvedValue({ rows: [], rowCount: 0 });
    getSession.mockResolvedValue(session());
    execute.mockResolvedValue({ product: { id: productId } });
  });
  it('refuses anonymous reads and manager reads before MFA', async () => {
    getSession.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .get('/api/catalogue/products')
      .expect(401);
    getSession.mockResolvedValueOnce(session('manager', false));
    await request(app.getHttpServer())
      .get('/api/catalogue/products')
      .expect(403);
    expect(query).not.toHaveBeenCalled();
  });
  it('permits cashier reads of active products, but denies archived products and history', async () => {
    getSession.mockResolvedValue(session('cashier'));
    await request(app.getHttpServer())
      .get('/api/catalogue/products')
      .expect(200)
      .expect({ products: [], hasMore: false });
    await request(app.getHttpServer())
      .get('/api/catalogue/products?status=all')
      .expect(403);
    await request(app.getHttpServer())
      .get(`/api/catalogue/products/${productId}/history`)
      .expect(403);
  });
  it('denies every cashier write, including CSV preview/import', async () => {
    getSession.mockResolvedValue(session('cashier'));
    for (const path of ['products', 'categories', 'imports/preview', 'imports'])
      await request(app.getHttpServer())
        .post(`/api/catalogue/${path}`)
        .set('Origin', origin)
        .send(body)
        .expect(403);
    await request(app.getHttpServer())
      .patch(`/api/catalogue/products/${productId}`)
      .set('Origin', origin)
      .send(body)
      .expect(403);
    expect(execute).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it('requires a trusted Origin before attempting a write', async () => {
    await request(app.getHttpServer())
      .post('/api/catalogue/products')
      .send(body)
      .expect(403);
    await request(app.getHttpServer())
      .post('/api/catalogue/products')
      .set('Origin', 'https://untrusted.example')
      .send(body)
      .expect(403);
    expect(execute).not.toHaveBeenCalled();
  });
  it('validates prices, revision and IDs at the HTTP boundary', async () => {
    await request(app.getHttpServer())
      .post('/api/catalogue/products')
      .set('Origin', origin)
      .send({ ...body, price: 180.05 })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/catalogue/products/${productId}`)
      .set('Origin', origin)
      .send(body)
      .expect(400);
    await request(app.getHttpServer())
      .get('/api/catalogue/products/not-a-uuid/history')
      .expect(400);
    expect(execute).not.toHaveBeenCalled();
  });
  it('passes server-normalized exact prices and the authenticated actor into the write', async () => {
    await request(app.getHttpServer())
      .post('/api/catalogue/products')
      .set('Origin', origin)
      .send(body)
      .expect(201);
    expect(execute).toHaveBeenCalledWith(
      { userId: 'manager-id', sessionId: 'session-id' },
      { requestId: body.requestId, reason: body.reason },
      expect.objectContaining({
        input: expect.objectContaining({ sku: 'RICE', priceMinor: '18005' }),
      }),
      expect.any(Function),
    );
  });
  it('reports invalid CSV before any catalogue write', async () => {
    await request(app.getHttpServer())
      .post('/api/catalogue/imports/preview')
      .set('Origin', origin)
      .send({ csv: 'name,price\nRice,10' })
      .expect(400);
    expect(execute).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
  });
  it('returns honest missing-barcode and database-outage responses', async () => {
    await request(app.getHttpServer())
      .get('/api/catalogue/products/by-barcode?code=00123')
      .expect(404);
    query.mockRejectedValueOnce(new Error('private SQL details'));
    const response = await request(app.getHttpServer())
      .get('/api/catalogue/products')
      .expect(503);
    expect(JSON.stringify(response.body)).not.toContain('private SQL');
    expect(response.headers['cache-control']).toBe('no-store');
  });
});
