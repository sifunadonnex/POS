import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PaymentAttemptsController } from './payment-attempts.controller.js';
import { PaymentAttemptsService } from './payment-attempts.service.js';
import { PaymentAttemptsStore } from './payment-attempts.store.js';
import { DisabledPaymentGateway, PAYMENT_GATEWAY } from './payment-gateway.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PaymentAttemptsController],
  providers: [
    PaymentAttemptsService,
    PaymentAttemptsStore,
    DisabledPaymentGateway,
    { provide: PAYMENT_GATEWAY, useExisting: DisabledPaymentGateway },
  ],
  exports: [PaymentAttemptsService],
})
export class PaymentsModule {}
