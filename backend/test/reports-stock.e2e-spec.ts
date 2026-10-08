import { type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AUTH } from '../src/identity/auth.js';
import { AUTH_CONFIG } from '../src/identity/auth.config.js';
import { StaffGuard } from '../src/identity/staff.guard.js';
import { ReportsController } from '../src/reports/reports.controller.js';
import { ReportsService } from '../src/reports/reports.service.js';

describe('stock report HTTP authorization', () => {
  let app: INestApplication<App>;
  const getSession = vi.fn();
  const stockPosition = vi.fn().mockResolvedValue({
    source: 'edge',
    products: [],
  });
  const operationDocuments = vi.fn().mockResolvedValue({
    source: 'edge',
    storeId: null,
    total: 0,
    documents: [],
  });
  const manager = (role: 'manager' | 'cashier', mfaVerified: boolean) => ({
    user: {
      id: 'staff',
      role,
      disabled: false,
      emailVerified: true,
      twoFactorEnabled: true,
    },
    session: { id: 'session', mfaVerified, lastActivityAt: new Date() },
  });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      controllers: [ReportsController],
      providers: [
        {
          provide: ReportsService,
          useValue: { stockPosition, operationDocuments },
        },
        { provide: AUTH, useValue: { api: { getSession } } },
        {
          provide: AUTH_CONFIG,
          useValue: { baseURL: 'http://localhost:5173' },
        },
        {
          provide: DatabaseService,
          useValue: {
            connectionPool: { query: vi.fn().mockResolvedValue({ rows: [] }) },
          },
        },
        { provide: APP_GUARD, useClass: StaffGuard },
      ],
    }).compile();
    app = fixture.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    getSession.mockReset();
    stockPosition.mockClear();
    operationDocuments.mockClear();
  });

  it('requires a signed-in manager with completed MFA', async () => {
    getSession.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).get('/api/reports/stock').expect(401);
    getSession.mockResolvedValueOnce(manager('cashier', true));
    await request(app.getHttpServer()).get('/api/reports/stock').expect(403);
    getSession.mockResolvedValueOnce(manager('manager', false));
    await request(app.getHttpServer()).get('/api/reports/stock').expect(403);
    expect(stockPosition).not.toHaveBeenCalled();
    getSession.mockResolvedValueOnce(manager('manager', true));
    await request(app.getHttpServer())
      .get('/api/reports/stock')
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(stockPosition).toHaveBeenCalledOnce();
  });

  it('keeps synchronized supplier and count documents manager-only', async () => {
    const url =
      '/api/reports/operation-documents?from=2026-10-08&to=2026-10-08';
    getSession.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).get(url).expect(401);
    getSession.mockResolvedValueOnce(manager('cashier', true));
    await request(app.getHttpServer()).get(url).expect(403);
    getSession.mockResolvedValueOnce(manager('manager', false));
    await request(app.getHttpServer()).get(url).expect(403);
    expect(operationDocuments).not.toHaveBeenCalled();
    getSession.mockResolvedValueOnce(manager('manager', true));
    await request(app.getHttpServer())
      .get(url)
      .expect(200)
      .expect('Cache-Control', 'no-store');
    expect(operationDocuments).toHaveBeenCalledWith(
      '2026-10-08',
      '2026-10-08',
      undefined,
    );
  });
});
