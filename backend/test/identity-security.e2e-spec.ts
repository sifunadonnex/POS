import { Test } from '@nestjs/testing';
import { APP_GUARD } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AUTH } from '../src/identity/auth.js';
import { AUTH_CONFIG } from '../src/identity/auth.config.js';
import { StaffGuard } from '../src/identity/staff.guard.js';
import { IdentityController } from '../src/identity/identity.controller.js';
import { StaffAdminController } from '../src/identity/staff-admin.controller.js';
import { StaffAdminService } from '../src/identity/staff-admin.service.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('staff security HTTP boundaries without PostgreSQL', () => {
  let app: INestApplication<App>;
  const query = vi.fn().mockResolvedValue({ rowCount: 1 });
  const getSession = vi.fn();
  const list = vi.fn().mockResolvedValue({ staff: [], hasMore: false });
  const update = vi.fn().mockResolvedValue({ status: true });
  function staff(overrides = {}) {
    return {
      user: {
        id: 'manager',
        name: 'Manager',
        email: 'manager@example.test',
        role: 'manager',
        emailVerified: true,
        disabled: false,
        twoFactorEnabled: true,
        ...overrides,
      },
      session: { id: 'session', mfaVerified: true, lastActivityAt: new Date() },
    };
  }
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [IdentityController, StaffAdminController],
      providers: [
        { provide: AUTH, useValue: { api: { getSession } } },
        {
          provide: AUTH_CONFIG,
          useValue: { baseURL: 'http://localhost:5173', smtp: null },
        },
        { provide: DatabaseService, useValue: { connectionPool: { query } } },
        { provide: StaffAdminService, useValue: { list, update } },
        { provide: APP_GUARD, useClass: StaffGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  afterAll(() => app.close());
  beforeEach(() => {
    vi.clearAllMocks();
    getSession.mockResolvedValue(staff());
    query.mockResolvedValue({ rowCount: 1 });
  });
  it('keeps capabilities public without looking up authentication', async () => {
    await request(app.getHttpServer())
      .get('/api/identity/options')
      .expect(200)
      .expect({ emailDelivery: false, idleSeconds: 900 });
    expect(getSession).not.toHaveBeenCalled();
  });
  it('refuses anonymous and cashier access to staff administration', async () => {
    getSession.mockResolvedValueOnce(null);
    await request(app.getHttpServer()).get('/api/identity/staff').expect(401);
    getSession.mockResolvedValueOnce(staff({ role: 'cashier' }));
    await request(app.getHttpServer()).get('/api/identity/staff').expect(403);
    expect(list).not.toHaveBeenCalled();
  });
  it('permits security setup but rejects manager data without session MFA proof', async () => {
    const value = staff();
    value.session.mfaVerified = false;
    getSession.mockResolvedValue(value);
    const me = await request(app.getHttpServer())
      .get('/api/identity/me')
      .expect(200);
    expect(me.body.user.mfaRequired).toBe(true);
    expect(me.body.user).not.toHaveProperty('disabled');
    await request(app.getHttpServer()).get('/api/identity/staff').expect(403);
    expect(list).not.toHaveBeenCalled();
  });
  it('rejects suspended and unverified users even with a formerly valid session', async () => {
    getSession.mockResolvedValueOnce(staff({ disabled: true }));
    await request(app.getHttpServer()).get('/api/identity/me').expect(401);
    getSession.mockResolvedValueOnce(staff({ emailVerified: false }));
    await request(app.getHttpServer()).get('/api/identity/me').expect(401);
  });
  it('does not let activity revive an expired idle session', async () => {
    const value = staff();
    value.session.lastActivityAt = new Date(Date.now() - 901_000);
    getSession.mockResolvedValue(value);
    await request(app.getHttpServer())
      .post('/api/identity/activity')
      .set('Origin', 'http://localhost:5173')
      .send({})
      .expect(401);
    expect(query).toHaveBeenCalledOnce();
  });
  it('requires the exact Origin for staff writes before invoking the service', async () => {
    await request(app.getHttpServer())
      .patch('/api/identity/staff/staff-id')
      .send({})
      .expect(403);
    await request(app.getHttpServer())
      .patch('/api/identity/staff/staff-id')
      .set('Origin', 'https://untrusted.example')
      .send({})
      .expect(403);
    expect(update).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .patch('/api/identity/staff/staff-id')
      .set('Origin', 'http://localhost:5173')
      .send({})
      .expect(200);
    expect(update).toHaveBeenCalledOnce();
  });
  it('allows a verified manager and keeps session polling from extending activity', async () => {
    await request(app.getHttpServer()).get('/api/identity/staff').expect(200);
    await request(app.getHttpServer()).get('/api/identity/me').expect(200);
    expect(query).not.toHaveBeenCalled();
  });
});
