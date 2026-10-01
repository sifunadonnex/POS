import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { SalesController } from './sales.controller.js';
import { SalesLookupService } from './sales-lookup.service.js';
import { SalesService } from './sales.service.js';
import { SalesWrites } from './sales-writes.js';
import { SuspendedOrdersService } from './suspended-orders.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [SalesController],
  providers: [
    SalesService,
    SalesLookupService,
    SalesWrites,
    SuspendedOrdersService,
  ],
  exports: [SalesService],
})
export class SalesModule {}
