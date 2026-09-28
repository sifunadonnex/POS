import { type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DatabaseService } from '../src/database/database.service.js';
import { AUTH } from '../src/identity/auth.js';
import { AUTH_CONFIG } from '../src/identity/auth.config.js';
import { StaffGuard } from '../src/identity/staff.guard.js';
import { PaymentAttemptsController } from '../src/payments/payment-attempts.controller.js';
import { PaymentAttemptsService } from '../src/payments/payment-attempts.service.js';

describe('payment callback HTTP boundary', () => {
  let app: INestApplication<App>;
  const callback = vi.fn();
  const getSession = vi.fn();

  beforeAll(async () => {
    callback.mockResolvedValue({ ResultCode: 0, ResultDesc: 'Accepted' });
    const fixture = await Test.createTestingModule({
      controllers: [PaymentAttemptsController],
      providers: [
        { provide: PaymentAttemptsService, useValue: { callback } },
        { provide: AUTH, useValue: { api: { getSession } } },
        {
          provide: AUTH_CONFIG,
          useValue: { baseURL: 'http://localhost:5173' },
        },
        {
          provide: DatabaseService,
          useValue: { connectionPool: {} },
        },
        { provide: APP_GUARD, useClass: StaffGuard },
      ],
    }).compile();
    app = fixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts the provider callback without a staff browser session', async () => {
    const body = {
      Body: {
        stkCallback: {
          CheckoutRequestID: 'ws_CO_123',
          ResultCode: 0,
        },
      },
    };

    await request(app.getHttpServer())
      .post('/api/payment-attempts/mpesa/callback?token=callback-token')
      .send(body)
      .expect(200)
      .expect({ ResultCode: 0, ResultDesc: 'Accepted' });

    expect(callback).toHaveBeenCalledWith('callback-token', body);
    expect(getSession).not.toHaveBeenCalled();
  });
});
