import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { InventoryController } from './inventory.controller.js';
import { InventoryService } from './inventory.service.js';
import { InventoryWrites } from './inventory-writes.js';

@Module({
  imports: [DatabaseModule],
  controllers: [InventoryController],
  providers: [InventoryService, InventoryWrites],
  exports: [InventoryService],
})
export class InventoryModule {}
