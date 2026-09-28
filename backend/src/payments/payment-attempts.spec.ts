import { Test } from '@nestjs/testing';
import { vi } from 'vitest';
import { PaymentAttemptsService } from './payment-attempts.service.js';
import {
  PaymentAttemptsStore,
  type PaymentAttemptRecord,
} from './payment-attempts.store.js';
import {
  DisabledPaymentGateway,
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from './payment-gateway.js';

const attempt: PaymentAttemptRecord = {
  id: '33333333-3333-4333-8333-333333333333',
  request_id: '11111111-1111-4111-8111-111111111111',
  actor_id: 'cashier',
  sale_id: '22222222-2222-4222-8222-222222222222',
  shift_id: '44444444-4444-4444-8444-444444444444',
  kind: 'mpesa',
  provider: 'test_mpesa',
  provider_reference: null,
  amount_minor: '2500',
  status: 'pending',
  request_fingerprint: 'fingerprint',
  reason: 'Customer payment',
  created_at: '2026-09-28T10:00:00.000Z',
  updated_at: '2026-09-28T10:00:00.000Z',
  confirmed_at: null,
  payment_id: null,
};

describe('PaymentAttemptsService', () => {
  it('reports that external methods are unavailable with the disabled gateway', async () => {
    const fixture = await Test.createTestingModule({
      providers: [
        PaymentAttemptsService,
        { provide: PaymentAttemptsStore, useValue: {} },
        DisabledPaymentGateway,
        { provide: PAYMENT_GATEWAY, useExisting: DisabledPaymentGateway },
      ],
    }).compile();

    expect(fixture.get(PaymentAttemptsService).capabilities()).toEqual({
      card: false,
      mpesa: false,
    });
  });

  it('keeps external payments unavailable without a configured gateway', async () => {
    const fixture = await Test.createTestingModule({
      providers: [
        PaymentAttemptsService,
        { provide: PaymentAttemptsStore, useValue: {} },
        DisabledPaymentGateway,
        { provide: PAYMENT_GATEWAY, useExisting: DisabledPaymentGateway },
      ],
    }).compile();

    await expect(
      fixture.get(PaymentAttemptsService).start(
        { userId: 'cashier', sessionId: 'session' },
        {
          requestId: '11111111-1111-4111-8111-111111111111',
          saleId: '22222222-2222-4222-8222-222222222222',
          kind: 'mpesa',
          reason: 'Customer payment',
          payerPhone: '0712345678',
        },
      ),
    ).rejects.toThrow('not configured');
  });

  it('normalizes a Kenyan phone before starting an M-Pesa request', async () => {
    const store = {
      prepare: vi.fn().mockResolvedValue({ created: true, record: attempt }),
      apply: vi.fn().mockResolvedValue({ status: 'pending' }),
    };
    const gateway: PaymentGateway = {
      name: 'test_mpesa',
      supports: (kind) => kind === 'mpesa',
      initiate: vi.fn().mockResolvedValue({
        status: 'pending',
        providerReference: 'ws_CO_123',
      }),
      reconcile: vi.fn(),
    };
    const fixture = await Test.createTestingModule({
      providers: [
        PaymentAttemptsService,
        { provide: PaymentAttemptsStore, useValue: store },
        { provide: PAYMENT_GATEWAY, useValue: gateway },
      ],
    }).compile();

    await fixture.get(PaymentAttemptsService).start(
      { userId: 'cashier', sessionId: 'session' },
      {
        requestId: attempt.request_id,
        saleId: attempt.sale_id,
        kind: 'mpesa',
        reason: attempt.reason,
        payerPhone: '0712 345 678',
      },
    );

    expect(gateway.initiate).toHaveBeenCalledWith(
      expect.objectContaining({ payerPhone: '254712345678' }),
    );
  });

  it('records an authenticated exact-amount callback against its provider reference', async () => {
    const callbackAttempt = {
      ...attempt,
      provider_reference: 'ws_CO_123',
    };
    const store = {
      byProviderReference: vi.fn().mockResolvedValue(callbackAttempt),
      apply: vi.fn().mockResolvedValue({ status: 'confirmed' }),
    };
    const gateway: PaymentGateway = {
      name: 'test_mpesa',
      supports: (kind) => kind === 'mpesa',
      initiate: vi.fn(),
      reconcile: vi.fn(),
      callback: vi.fn().mockReturnValue({
        status: 'confirmed',
        amountMinor: 2500,
        providerReference: 'ws_CO_123',
        providerEventId: 'QAA123',
      }),
    };
    const fixture = await Test.createTestingModule({
      providers: [
        PaymentAttemptsService,
        { provide: PaymentAttemptsStore, useValue: store },
        { provide: PAYMENT_GATEWAY, useValue: gateway },
      ],
    }).compile();

    await expect(
      fixture.get(PaymentAttemptsService).callback('secret', {}),
    ).resolves.toEqual({ ResultCode: 0, ResultDesc: 'Accepted' });
    expect(store.apply).toHaveBeenCalledWith(
      attempt.id,
      'callback',
      expect.objectContaining({
        status: 'confirmed',
        providerReference: 'ws_CO_123',
      }),
    );
  });
});
