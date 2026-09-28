import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/environment.js';
import { ConfigModule } from '../config/config.module.js';
import { DatabaseModule } from '../database/database.module.js';
import { DarajaMpesaGateway } from './daraja-mpesa.gateway.js';
import { PaymentAttemptsController } from './payment-attempts.controller.js';
import { PaymentAttemptsService } from './payment-attempts.service.js';
import { PaymentAttemptsStore } from './payment-attempts.store.js';
import { DisabledPaymentGateway, PAYMENT_GATEWAY } from './payment-gateway.js';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [PaymentAttemptsController],
  providers: [
    PaymentAttemptsService,
    PaymentAttemptsStore,
    {
      provide: PAYMENT_GATEWAY,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.daraja
          ? new DarajaMpesaGateway(config.daraja)
          : new DisabledPaymentGateway(),
    },
  ],
  exports: [PaymentAttemptsService],
})
export class PaymentsModule {}
