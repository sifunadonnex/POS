import { type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AUTH } from '../src/identity/auth.js';
import { AUTH_CONFIG } from '../src/identity/auth.config.js';
import { StaffGuard } from '../src/identity/staff.guard.js';
import { BootstrapController } from '../src/store/bootstrap.controller.js';
import { EdgeBootstrapService } from '../src/store/edge-bootstrap.service.js';
import { HostedBootstrapService } from '../src/store/hosted-bootstrap.service.js';

describe('bootstrap HTTP authorization', () => {
  let app: INestApplication<App>;
  const getSession = vi.fn();
  const publish = vi.fn().mockResolvedValue({ publicationId: 'publication' });
  const signOffOpening = vi.fn().mockResolvedValue({ status: 'applied' });
  const identity = { userId: 'manager', sessionId: 'session' };
  const manager = (mfaVerified: boolean) => ({
    user: {
      id: 'manager',
      role: 'manager',
      disabled: false,
      emailVerified: true,
      twoFactorEnabled: true,
    },
    session: { id: 'session', mfaVerified, lastActivityAt: new Date() },
  });

  beforeAll(async () => {
    const fixture = await Test.createTestingModule({
      controllers: [BootstrapController],
      providers: [
        { provide: HostedBootstrapService, useValue: { publish } },
        { provide: EdgeBootstrapService, useValue: { signOffOpening } },
        { provide: AUTH, useValue: { api: { getSession } } },
        {
          provide: AUTH_CONFIG,
          useValue: { baseURL: 'http://localhost:5173' },
        },
        { provide: DatabaseService, useValue: { connectionPool: {} } },
        { provide: APP_GUARD, useClass: StaffGuard },
      ],
    }).compile();
    app = fixture.createNestApplication();
    await app.init();
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    getSession.mockReset();
    publish.mockClear();
    signOffOpening.mockClear();
  });

  it('denies absent, cashier, and unverified manager sessions for publication', async () => {
    getSession.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .post('/api/bootstrap/publications')
      .set('Origin', 'http://localhost:5173')
      .expect(401);
    getSession.mockResolvedValueOnce({
      ...manager(true),
      user: { ...manager(true).user, role: 'cashier' },
    });
    await request(app.getHttpServer())
      .post('/api/bootstrap/publications')
      .set('Origin', 'http://localhost:5173')
      .expect(403);
    getSession.mockResolvedValueOnce(manager(false));
    await request(app.getHttpServer())
      .post('/api/bootstrap/publications')
      .set('Origin', 'http://localhost:5173')
      .expect(403);
    expect(publish).not.toHaveBeenCalled();
  });

  it('passes only MFA-proven manager requests to publication and signoff', async () => {
    getSession.mockResolvedValue(manager(true));
    await request(app.getHttpServer())
      .post('/api/bootstrap/publications')
      .set('Origin', 'http://localhost:5173')
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/bootstrap/opening-stock')
      .set('Origin', 'http://localhost:5173')
      .send({ counts: [] })
      .expect(201);
    expect(publish).toHaveBeenCalledWith(identity);
    expect(signOffOpening).toHaveBeenCalledWith(identity, { counts: [] });
  });
});
