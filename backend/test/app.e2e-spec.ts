import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { AppModule } from './../src/app.module.js';
import { APP_CONFIG, parseEnvironment } from '../src/config/environment.js';
import { DatabaseService } from '../src/database/database.service.js';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;
  const database = { checkConnection: vi.fn<() => Promise<void>>() };

  beforeEach(async () => {
    database.checkConnection.mockReset().mockResolvedValue(undefined);
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(APP_CONFIG)
      .useValue(
        parseEnvironment({
          DATABASE_URL: 'postgresql://test:fake@127.0.0.1/pay_and_go_test',
          DATABASE_TLS: 'disable',
          NODE_ENV: 'test',
        }),
      )
      .overrideProvider(DatabaseService)
      .useValue(database)
      .compile();

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
  });

  it('readiness checks connectivity', async () => {
    await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200)
      .expect('Cache-Control', 'no-store')
      .expect({ status: 'ok', database: 'reachable' });
    expect(database.checkConnection).toHaveBeenCalledOnce();
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
