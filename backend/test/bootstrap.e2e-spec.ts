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
import { HostedConfigurationService } from '../src/store/hosted-configuration.service.js';
import { EdgeConfigurationService } from '../src/store/edge-configuration.service.js';
import { HostedCutoverService } from '../src/store/hosted-cutover.service.js';
import { EdgeStaffEnrollmentService } from '../src/store/edge-staff-enrollment.service.js';

describe('bootstrap HTTP authorization', () => {
  let app: INestApplication<App>;
  const getSession = vi.fn();
  const publish = vi.fn().mockResolvedValue({ publicationId: 'publication' });
  const signOffOpening = vi.fn().mockResolvedValue({ status: 'applied' });
  const publishChanges = vi.fn().mockResolvedValue({ toVersion: 2 });
  const checkpoint = vi.fn().mockResolvedValue({ version: 2 });
  const issue = vi.fn().mockResolvedValue({ signature: 'a'.repeat(64) });
  const issueGrant = vi.fn().mockResolvedValue({ grantId: 'grant' });
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
        { provide: HostedConfigurationService, useValue: { publishChanges } },
        { provide: EdgeConfigurationService, useValue: { checkpoint } },
        { provide: HostedCutoverService, useValue: { issue } },
        { provide: EdgeStaffEnrollmentService, useValue: { issueGrant } },
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
    publish.mockClear();
    signOffOpening.mockClear();
    publishChanges.mockClear();
    checkpoint.mockClear();
    issue.mockClear();
    issueGrant.mockClear();
  });

  it('guards both cutover and replacement fencing with manager MFA', async () => {
    const body = {
      requestId: '11111111-1111-4111-8111-111111111111',
      expectedGeneration: 1,
      configurationVersion: 1,
      configurationDigest: 'a'.repeat(64),
    };
    getSession.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .post('/api/bootstrap/cutover')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(401);
    getSession.mockResolvedValueOnce({
      ...manager(true),
      user: { ...manager(true).user, role: 'cashier' },
    });
    await request(app.getHttpServer())
      .post('/api/bootstrap/fence')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(403);
    getSession.mockResolvedValueOnce(manager(false));
    await request(app.getHttpServer())
      .post('/api/bootstrap/cutover')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(403);
    expect(issue).not.toHaveBeenCalled();
    getSession.mockResolvedValue(manager(true));
    await request(app.getHttpServer())
      .post('/api/bootstrap/cutover')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/bootstrap/fence')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(201);
    expect(issue).toHaveBeenNthCalledWith(1, identity, 'cutover', body);
    expect(issue).toHaveBeenNthCalledWith(2, identity, 'fence', body);
  });

  it('denies cashier and unverified-manager configuration access', async () => {
    getSession.mockResolvedValueOnce({
      ...manager(true),
      user: { ...manager(true).user, role: 'cashier' },
    });
    await request(app.getHttpServer())
      .post('/api/bootstrap/changes')
      .set('Origin', 'http://localhost:5173')
      .send({ afterVersion: 1, afterDigest: 'a'.repeat(64) })
      .expect(403);
    getSession.mockResolvedValueOnce(manager(false));
    await request(app.getHttpServer())
      .get('/api/bootstrap/checkpoint')
      .expect(403);
    expect(publishChanges).not.toHaveBeenCalled();
    expect(checkpoint).not.toHaveBeenCalled();
  });

  it('allows enrollment grants only from a same-origin MFA-proven manager', async () => {
    const body = { staffId: 'cashier-1' };
    getSession.mockResolvedValueOnce(null);
    await request(app.getHttpServer())
      .post('/api/bootstrap/enrollment-grants')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(401);
    getSession.mockResolvedValueOnce({
      ...manager(true),
      user: { ...manager(true).user, role: 'cashier' },
    });
    await request(app.getHttpServer())
      .post('/api/bootstrap/enrollment-grants')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(403);
    getSession.mockResolvedValueOnce(manager(false));
    await request(app.getHttpServer())
      .post('/api/bootstrap/enrollment-grants')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(403);
    getSession.mockResolvedValueOnce(manager(true));
    await request(app.getHttpServer())
      .post('/api/bootstrap/enrollment-grants')
      .set('Origin', 'https://untrusted.example')
      .send(body)
      .expect(403);
    expect(issueGrant).not.toHaveBeenCalled();
    await request(app.getHttpServer())
      .post('/api/bootstrap/enrollment-grants')
      .set('Origin', 'http://localhost:5173')
      .send(body)
      .expect(201)
      .expect('Cache-Control', 'no-store');
    expect(issueGrant).toHaveBeenCalledWith(identity, body);
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
    await request(app.getHttpServer())
      .post('/api/bootstrap/changes')
      .set('Origin', 'http://localhost:5173')
      .send({ afterVersion: 1, afterDigest: 'a'.repeat(64) })
      .expect(201);
    await request(app.getHttpServer())
      .get('/api/bootstrap/checkpoint')
      .expect(200);
    expect(publish).toHaveBeenCalledWith(identity);
    expect(signOffOpening).toHaveBeenCalledWith(identity, { counts: [] });
    expect(publishChanges).toHaveBeenCalledWith(identity, {
      afterVersion: 1,
      afterDigest: 'a'.repeat(64),
    });
    expect(checkpoint).toHaveBeenCalledOnce();
  });
});
