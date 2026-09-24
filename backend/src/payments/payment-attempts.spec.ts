import { Test } from '@nestjs/testing';
import { PaymentAttemptsService } from './payment-attempts.service.js';
import { PaymentAttemptsStore } from './payment-attempts.store.js';
import { DisabledPaymentGateway, PAYMENT_GATEWAY } from './payment-gateway.js';

describe('PaymentAttemptsService', () => {
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
        },
      ),
    ).rejects.toThrow('not configured');
  });
});
