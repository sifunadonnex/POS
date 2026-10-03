import { type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AUTH } from '../src/identity/auth.js';
import { AUTH_CONFIG } from '../src/identity/auth.config.js';
import { StaffGuard } from '../src/identity/staff.guard.js';
import { EdgeSyncController } from '../src/sync/edge-sync.controller.js';
import { EdgeSyncService } from '../src/sync/edge-sync.service.js';
import { HostedSyncService } from '../src/sync/hosted-sync.service.js';

describe('store synchronization HTTP boundary', () => {
  let app: INestApplication<App>;
  const ingest = vi.fn();
  const getSession = vi.fn();

  beforeAll(async () => {
    ingest.mockResolvedValue({
      eventId: '22222222-2222-4222-8222-222222222222',
      status: 'accepted',
      checkpoint: { acceptedEvents: 1, latestReceivedAt: null },
    });
    const fixture = await Test.createTestingModule({
      controllers: [EdgeSyncController],
      providers: [
        { provide: EdgeSyncService, useValue: { status: vi.fn() } },
        { provide: HostedSyncService, useValue: { ingest } },
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

  it('routes a signed store request without requiring a browser session', async () => {
    const body = { eventId: '22222222-2222-4222-8222-222222222222' };
    await request(app.getHttpServer())
      .post('/api/sync/events')
      .set('X-PayGo-Store-Id', '11111111-1111-4111-8111-111111111111')
      .set('X-PayGo-Event-Id', body.eventId)
      .set('X-PayGo-Timestamp', '1790942400')
      .set('X-PayGo-Signature', 'a'.repeat(64))
      .send(body)
      .expect(200)
      .expect({
        eventId: body.eventId,
        status: 'accepted',
        checkpoint: { acceptedEvents: 1, latestReceivedAt: null },
      });

    expect(ingest).toHaveBeenCalledWith(
      {
        storeId: '11111111-1111-4111-8111-111111111111',
        eventId: body.eventId,
        timestamp: '1790942400',
        signature: 'a'.repeat(64),
        generation: undefined,
      },
      body,
    );
    expect(getSession).not.toHaveBeenCalled();
  });

  it('keeps synchronization reconciliation behind staff authentication', async () => {
    getSession.mockResolvedValueOnce(null);

    await request(app.getHttpServer())
      .get('/api/sync/reconciliation')
      .expect(401);

    expect(getSession).toHaveBeenCalledOnce();
  });
});
