import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppController } from '../src/app.controller.js';
import { AppService } from '../src/app.service.js';
import { HealthController } from '../src/health/health.controller.js';
import { APP_GUARD } from '@nestjs/core';
import { AUTH } from '../src/identity/auth.js';
import { StaffGuard } from '../src/identity/staff.guard.js';
import { IdentityController } from '../src/identity/identity.controller.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const database = { checkConnection: vi.fn<() => Promise<void>>() };
  const auth = { api: { getSession: vi.fn() } };

  beforeEach(async () => {
    database.checkConnection.mockReset().mockResolvedValue(undefined);
    auth.api.getSession
      .mockReset()
      .mockRejectedValue(new Error('Auth unavailable'));
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController, HealthController, IdentityController],
      providers: [
        AppService,
        { provide: DatabaseService, useValue: database },
        { provide: AUTH, useValue: auth },
        { provide: APP_GUARD, useClass: StaffGuard },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');
  });

  afterEach(async () => {
    await app.close();
  });

  it('liveness does not query the database', async () => {
    await request(app.getHttpServer())
      .get('/api/health/live')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'ok' });
    expect(database.checkConnection).not.toHaveBeenCalled();
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it('readiness checks connectivity', async () => {
    await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'ok', database: 'reachable' });
    expect(database.checkConnection).toHaveBeenCalledOnce();
  });

  it('fails closed with a sanitized 503 if authentication storage is unavailable', async () => {
    await request(app.getHttpServer())
      .get('/api/identity/me')
      .expect(503)
      .expect('Cache-Control', 'no-store')
      .expect({
        message: 'Authentication is temporarily unavailable',
        error: 'Service Unavailable',
        statusCode: 503,
      });
  });

  it('database failure returns 503 without leaking internal details', async () => {
    database.checkConnection.mockRejectedValue(
      new Error('password=secret internal-host'),
    );
    await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(503)
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'unavailable', database: 'unreachable' });
    await request(app.getHttpServer()).get('/api/health/live').expect(200);
  });
});
