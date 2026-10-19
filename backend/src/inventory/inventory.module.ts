import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { InventoryWrites } from './inventory-writes.js';
import { ValuationController } from './valuation.controller.js';
import { ValuationService } from './valuation.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [InventoryController, ValuationController],
  providers: [InventoryService, InventoryWrites, ValuationService],
  exports: [InventoryService],
})
export class InventoryModule {}
