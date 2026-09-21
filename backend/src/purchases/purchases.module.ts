import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module.js';
import { PurchasesController } from './purchases.controller.js';
import { PurchasesService } from './purchases.service.js';
import { PurchasesWrites } from './purchases-writes.js';
import { SuppliersService } from './suppliers.service.js';

@Module({
  imports: [DatabaseModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, PurchasesWrites, SuppliersService],
  exports: [PurchasesService],
})
export class PurchasesModule {}
