import { RegisterBasketService } from './register-basket.service.js';
import { CartApprovalService } from './cart-approval.service.js';
import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { EdgeSyncModule } from '../sync/edge-sync.module.js';
import { SalesController } from './sales.controller.js';
import { SalesLookupService } from './sales-lookup.service.js';
import { SalesService } from './sales.service.js';
import { SalesWrites } from './sales-writes.js';
import { SuspendedOrdersService } from './suspended-orders.service.js';

@Module({
  imports: [DatabaseModule, EdgeSyncModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    RegisterBasketService,
    CartApprovalService,
    SalesLookupService,
    SalesWrites,
    SuspendedOrdersService,
  ],
  exports: [SalesService],
})
export class SalesModule {}
